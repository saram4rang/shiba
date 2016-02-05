'use strict';

const _        = require('lodash');
const assert   = require('assert');
const pg       = require('co-pg')(require('pg'));
const debug    = require('debug')('shiba:db');
const debugpg  = require('debug')('verbose:db:pg');

const Cache  = require('./Util/Cache');
const Config = require('./Config');
const Lib    = require('./Lib');

pg.defaults.poolSize        = 3;
pg.defaults.poolIdleTimeout = 500000;

// Parse int8 as an integer
pg.types.setTypeParser(20, val =>
  val === null ? null : parseInt(val, 10)
);

let querySeq = 0;
function *query(sql, params) {
  let qid = querySeq++;
  debugpg(`[${qid}] Executing query "${sql}"`);
  if (params)
    debugpg(`[${qid}] Parameters ${JSON.stringify(params)}`);
  else
    params = [];

  let vals   = yield pg.connectPromise(Config.DATABASE);
  let client = vals[0];
  let done   = vals[1];

  try {
    let result = yield client.queryPromise(sql, params);
    debugpg(`[${qid}] Finished query`);
    return result;
  } catch(err) {
    // console.error('Query [%d] failed with %s', qid, err.toString());
    // console.error('Parameters: ', params);
    // console.error('Statement:');
    // console.error(sql);
    throw err;
  } finally {
    // Release client back to pool
    done();
  }
}
exports.query = query;

/**
 * Runs a session and retries if it deadlocks.
 *
 * @param {String} runner A generator expecting a query function.
 * @return {?} Session result.
 * @api private
 */
function* withClient(runner) {
  let vals   = yield pg.connectPromise(Config.DATABASE);
  let client = vals[0];
  let done   = vals[1];

  try {
    let result = yield* runner(function*(sql, params) {
      let qid = querySeq++;
      debugpg(`[${qid}] Executing query "${sql}"`);
      if (params)
        debugpg(`[${qid}] Parameters ${JSON.stringify(params)}`);
      else
        params = [];

      let result = yield client.queryPromise(sql, params);
      debugpg(`[${qid}] Finished query`);
      return result;
    });
    done();
    return result;
  } catch (ex) {
    // Check for deadlocks.
    if (ex.code === '40P01') {
      console.warn('Deadlock detected. Retrying..');
      done();
      yield* withClient(runner);
    } else {
      console.error(ex);
      console.error(ex.stack);

      if (ex.removeFromPool) {
        console.error('[ERROR] withClient: removing connection from pool');
        done(new Error('Removing connection from pool'));
      } else {
        done();
      }
      throw ex;
    }
  }
}

let txSeq = 0;

/**
 * Runs a single transaction and retry if it deadlocks. This function
 * takes care of BEGIN and COMMIT. The session runner should never
 * perform these queries itself.
 *
 * @param {String} runner A generator expecting a query function.
 * @return {?} Transaction result.
 * @api private
 */
function* withTransaction(runner) {
  return yield* withClient(function*(query) {
    let txid = txSeq++;
    try {
      debugpg(`[${txid}] Starting transaction`);
      yield* query('BEGIN');
      let result = yield* runner(query);
      debugpg(`[${txid}] Committing transaction`);
      yield* query('COMMIT');
      debugpg(`[${txid}] Finished transaction`);
      return result;
    } catch (ex) {
      try {
        yield* query('ROLLBACK');
      } catch(ex) {
        ex.removeFromPool = true;
        throw ex;
      }
      throw ex;
    }
  });
}

function* getOrCreateUser(username) {
  debug(`GetOrCreateUser user: ${username}`);

  return yield* withTransaction(function*(query) {
    let res = yield* query(
      'SELECT * FROM users WHERE lower(username) = lower($1)',
      [username]
    );

    if (res.rows.length > 0) {
      // User exists. Return the first (and only) row.
      assert(res.rows.length === 1);
      return res.rows[0];
    }

    // Create new user.
    res = yield* query(
      'INSERT INTO users(username) VALUES($1) RETURNING username, id',
      [username]
    );

    assert(res.rows.length === 1);
    return res.rows[0];
  });
}

function* getExistingUser(username) {
  debug(`Getting user: ${username}`);

  if (Lib.isInvalidUsername(username))
    throw 'USERNAME_INVALID';

  let res = yield* query(
    'SELECT * FROM users WHERE lower(username) = lower($1)',
    [username]
  );

  if (res.rows.length <= 0)
    throw 'USER_DOES_NOT_EXIST';

  // User exists. Return the first (and only) row.
  assert(res.rows.length === 1);
  return res.rows[0];
}

const userCache = new Cache({
  // Cache users for 1 day.
  maxAge: 1000 * 60 * 60 * 24,
  max: 10000,
  load : getOrCreateUser
});

function* getUser(username) {
  if (Lib.isInvalidUsername(username))
    throw 'USERNAME_INVALID';

  try {
    return yield* userCache.get(username);
  } catch(err) {
    console.error('[Pg.getUser] ERROR:', err && err.stack || err);
    throw err;
  }
}

/*
CREATE TABLE chats (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  channel text NOT NULL,
  message text NOT NULL,
  is_bot boolean NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
*/
exports.putChat = function*(username, channelName, message, isBot, timestamp) {
  debug(`Recording chat message. User: ${username}`);
  let user = yield* getUser(username);

  try {
    yield* query(
      `INSERT INTO chats(user_id, channel, message, is_bot, created)
         VALUES ($1, $2, $3, $4, $5)`,
       [user.id, channelName, message, isBot, timestamp]
    );
  } catch(err) {
    console.log('ARGUMENTS:', arguments);
    if (err instanceof Error)
      console.error('[Pg.putChat] ERROR:', err.stack);
    else
      console.error('[Pg.putChat] ERROR:', err);
  }
};

/*
CREATE TABLE mutes (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  moderator_id bigint NOT NULL,
  timespec text NOT NULL,
  shadow boolean DEFAULT false NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
*/
exports.putMute = function*(username, moderator, timespec, shadow, timestamp) {
  debug(`Recording mute. User: ${username} Moderator ${moderator}`);

  let vals = yield [username, moderator].map(getUser);
  let usr = vals[0], mod = vals[1];
  yield* query(
    `INSERT INTO mutes(user_id, moderator_id, timespec, shadow, created)
     VALUES ($1, $2, $3, $4, $5)`,
    [usr.id, mod.id, timespec, shadow, timestamp]
  );
};

exports.putUnmute = function*(username, moderatorname, shadow, timestamp) {
  debug(`Recording unmute. User: ${username} Moderator: ${moderatorname}`);

  let vals = yield [username, moderatorname].map(getUser);
  let usr = vals[0], mod = vals[1];
  yield* query(
    `INSERT INTO unmutes(user_id, moderator_id, shadow, created)
     VALUES ($1, $2, $3, $4)`,
    [usr.id, mod.id, shadow, timestamp]
  );
};

exports.putMsg = function*(msg) {
  switch (msg.type) {
  case 'say':
    yield* this.putChat(
      msg.username,
      msg.channelName,
      msg.message,
      msg.bot,
      new Date(msg.date)
    );
    break;
  case 'mute':
    yield* this.putMute(
      msg.username, msg.moderator, msg.timespec,
      msg.shadow, new Date(msg.date));
    break;
  case 'unmute':
    yield* this.putUnmute(
      msg.username, msg.moderator, msg.shadow,
      new Date(msg.date));
    break;
  case 'error':
  case 'info':
    break;
  default:
    throw 'UNKNOWN_MSG_TYPE';
  }
};

exports.getLastMessages = function*() {
  debug('Retrieving last chat messages');

  let sql1 =
    `SELECT
       chats.created AS date, 'say' AS type, username, message
     FROM chats JOIN users ON chats.user_id = users.id
     ORDER BY date DESC LIMIT $1`;
  let sql2 =
    `SELECT
       mutes.created AS date, 'mute' AS type, m.username AS moderator,
       u.username, timespec, shadow
     FROM mutes
       JOIN users AS m ON mutes.moderator_id = m.id
       JOIN users AS u ON mutes.user_id = u.id
     ORDER BY date DESC LIMIT $1`;
  let sql3 =
    `SELECT
       unmutes.created AS date, 'unmute' AS type, m.username AS moderator,
       u.username, shadow
     FROM unmutes
       JOIN users AS m ON unmutes.moderator_id = m.id
       JOIN users AS u ON unmutes.user_id = u.id
     ORDER BY date DESC LIMIT $1`;
  let par = [Config.CHAT_HISTORY];

  let res = yield [sql1, sql2, sql3].map(sql => query(sql, par));
  res = res[0].rows.concat(res[1].rows, res[2].rows);
  res = res.sort((a, b) => new Date(a.date) - new Date(b.date));

  return res;
};

exports.putGame = function*(info) {
  let players = Object.keys(info.player_info);

  // Step1: Resolve all player names.
  let users   = yield players.map(getUser);
  let userIds = {};
  _.forEach(users, user => userIds[user.username] = user.id);

  let wagered   = 0;
  let cashedOut = 0;
  let bonused   = 0;
  let numPlayed = 0;
  _.forEach(info.player_info, play => {
    wagered   += play.bet;
    cashedOut += play.bet * (play.stopped_at || 0) / 100;
    bonused   += play.bonus || 0;
    numPlayed += 1;
  });

  // Insert into the games and plays table in a common transaction.
  debug('Recording info for game #' + info.game_id);
  yield* withTransaction(function*(query) {
    debugpg(`Inserting game data for game #${info.game_id}`);

    yield* query(
      `INSERT INTO
       games(id, game_crash, seed, created, started, wagered, cashed_out, bonused, num_played)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [ info.game_id, info.game_crash, info.server_seed || info.hash,
        new Date(info.created), new Date(info.startTime),
        wagered, cashedOut, bonused, numPlayed
      ]
    );

    for (let player in info.player_info) {
      debugpg(`Inserting play for ${player}`);
      let play = info.player_info[player];

      yield* query(
        `INSERT INTO plays(user_id, cash_out, game_id, bet, bonus, joined)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ userIds[player],
          play.stopped_at ? Math.round(play.bet * play.stopped_at / 100) : null,
          info.game_id, play.bet, play.bonus || null, play.joined || null
        ]
      );
    };
  });
};

/*
CREATE TABLE licks (
  id bigint NOT NULL,
  user_id bigint NOT NULL,
  message text NOT NULL,
  creator_id bigint,
  created timestamp with time zone DEFAULT now() NOT NULL
);
*/
exports.putLick = function*(username, message, creatorname) {
  debug('Recording custom lick message for user: ' + username);

  let vals    = yield [username, creatorname].map(getUser);
  let user    = vals[0];
  let creator = vals[1];

  yield* query(
    'INSERT INTO licks(user_id, message, creator_id) VALUES ($1, $2, $3)',
    [user.id, message, creator.id]
  );
};

exports.getLastGames = function*() {
  debug('Retrieving last games');

  let res = yield* query(
    `SELECT * FROM (
       SELECT id AS game_id, game_crash, created, seed AS hash
       FROM games ORDER BY id DESC LIMIT $1) t
      ORDER BY game_id`,
    [Config.GAME_HISTORY]
  );
  return res.rows;
};

exports.getLick = function*(username) {
  debug('Getting custom lick messages for user: ' + username);
  let user = yield* getExistingUser(username);
  let res  = yield* query('SELECT message FROM licks WHERE user_id = $1',
    [user.id]
  );

  return {
    username: user.username,
    licks: res.rows.map(row => row.message)
  };
};

exports.getBust = function*(qry) {
  debug(`Getting last bust: ${JSON.stringify(qry)}`);

  let sql;
  if (qry === 'MAX') {
    sql = `SELECT * FROM games WHERE id =
            (SELECT id FROM game_crashes
             ORDER BY game_crash DESC LIMIT 1)`;
  } else {
    let min   = qry.hasOwnProperty('min') ?
                  ' AND game_crash >= ' + qry.min : '';
    let max   = qry.hasOwnProperty('max') ?
                  ' AND game_crash <= ' + qry.max : '';
    sql = `SELECT * FROM games WHERE id =
            (SELECT id FROM game_crashes
              WHERE TRUE ${min} ${max}
              ORDER BY id DESC LIMIT 1)`;
  }

  try {
    let data = yield* query(sql);
    return data.rows;
  } catch(err) {
    console.error(err);
    throw err;
  }
};

exports.addAutomute = function*(creator, regex) {
  debug(`Adding automute ${regex}`);

  try {
    let user = yield* getUser(creator);
    yield* query(
      'INSERT INTO automutes(creator_id, regexp) VALUES($1, $2)',
      [user.id, regex.toString()]
    );
  } catch(err) {
    console.error(err);
    throw err;
  }
};

exports.getAutomutes = function*() {
  debug('Getting automute list.');

  let data = yield* query('SELECT regexp FROM automutes WHERE enabled');
  let reg = /^\/(.*)\/([gi]*)$/;
  let res = data.rows.map(row => {
    let match = row.regexp.match(reg);
    return new RegExp(match[1], match[2]);
  });

  return res;
};

exports.getLastSeen = function*(username) {
  debug(`Getting last chat message of user ${username}`);

  let user = yield* getExistingUser(username);
  let data = yield* query(
    `SELECT created FROM chats WHERE user_id = $1
       ORDER BY created DESC LIMIT 1`,
    [user.id]
  );

  return data.rows.length > 0 ?
    // Return the first (and only) row.
    {
      username: user.username,
      time:     new Date(data.rows[0].created)
    } :
    // User never said anything.
    {
      username: user.username
    };
};

exports.getLatestBlock = function*() {
  debug('Getting last block from DB');
  let data = yield* query('SELECT * FROM blocks ORDER BY height DESC LIMIT 1');
  return data.rows[0];
};

exports.putBlock = function*(block) {
  try {
    yield* query(
      'INSERT INTO blocks(height, hash) VALUES($1, $2)',
      [block.height, block.hash]
    );
  } catch(err) {
    // Ignore unique_violation code 23505.
    if (err.code === 23505 || err.code === '23505')
      debugpg('Block database entry already exists');
    else
      throw err;
  }
};

exports.getBlockNotifications = function*() {
  debug('Getting block notification list');
  let data = yield* query(
    `SELECT channel_name, array_agg(username) AS users
       FROM blocknotifications GROUP BY channel_name`
  );

  let map = new Map();
  data.rows.forEach(val => map.set(val.channel_name, val.users));
  return map;
};

exports.putBlockNotification = function*(user, channel) {
  debug(`Adding ${user} to block notification list on channel ${channel}`);

  try {
    yield* query(
      `INSERT INTO blocknotifications(username, channel_name) VALUES($1, $2)`,
      [user, channel]
    );
  } catch(err) {
    // Ignore unique_violation code 23505.
    if (err.code !== 23505 && err.code !== '23505') throw err;
  }
};

exports.clearBlockNotifications = function*() {
  debug('Clearing block notification list');
  yield* query('DELETE FROM blocknotifications');
};

exports.getGameCrashMedian = function*(numGames) {
  debug('Retrieving game crash median');

  let data = yield* query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY game_crash) AS median,
       COUNT(*)
     FROM (SELECT game_crash FROM games ORDER BY id DESC LIMIT $1) t`,
    [numGames]
  );
  return data.rows[0];
};

exports.getLastStreak = function*(count, op, bound) {
  debug('Retrieving last streak');

  let data = yield* query(
    `WITH
       t1 AS
         (SELECT
            id,
            CASE WHEN id IS DISTINCT FROM (lag(id) OVER (ORDER BY id)) + 1
              THEN id
            END AS id_start
          FROM games WHERE game_crash ${op} $1),
       t2 AS (SELECT id, max(id_start) OVER (ORDER BY id) AS id_group FROM t1),
       best AS
         (SELECT id_group, COUNT(*) FROM t2 GROUP BY id_group
          HAVING count(*) >= $2 ORDER BY id_group DESC LIMIT 1)
     SELECT id game_id, game_crash game_crash FROM games, best
     WHERE id >= best.id_group AND id < best.id_group + best.count
     ORDER BY id`,
    [bound, count]
  );

  return data.rows;
};

exports.getMaxStreak = function*(op, bound) {
  debug('Retrieving max streak');

  let data = yield* query(
    `WITH
       t1 AS
         (SELECT
            id,
            CASE WHEN id IS DISTINCT FROM (lag(id) OVER (ORDER BY id)) + 1
              THEN id
            END AS id_start
          FROM games
          WHERE game_crash ${op} $1),
       t2 AS
         (SELECT id, max(id_start) OVER (ORDER BY id) AS id_group
          FROM t1),
       best AS
         (SELECT id_group, COUNT(*) AS count
          FROM t2
          GROUP BY id_group
          ORDER BY count DESC LIMIT 1)
     SELECT id game_id, game_crash game_crash
     FROM games, best
     WHERE id >= best.id_group AND id < best.id_group + best.count
     ORDER BY id`,
    [bound]
  );

  return data.rows;
};

exports.getProfitTime = function*(username, time) {
  let res = yield* query(
    `SELECT SUM(COALESCE(cash_out,0) - bet + COALESCE(bonus,0)) AS profit
     FROM plays WHERE user_id = userIdOf($1) AND game_id >= (
       SELECT id FROM games WHERE created >= $2 ORDER BY id ASC LIMIT 1)`,
    [username, new Date(Date.now() - time)]
  );
  return res.rows[0].profit;
};

exports.getProfitGames = function*(username, games) {
  let res = yield* query(
    `SELECT SUM(COALESCE(cash_out,0) - bet + COALESCE(bonus,0)) AS profit
     FROM (SELECT * FROM plays WHERE user_id = userIdOf($1)
           ORDER BY game_id DESC LIMIT $2) t`,
    [username, games]
  );
  return res.rows[0].profit;
};

exports.getSiteProfitTime = function*(time) {
  let res = yield* query(
    `SELECT SUM(wagered) - SUM(cashed_out) - SUM(bonus) AS profit
       FROM games WHERE created >= $1`,
    [new Date(Date.now() - time)]
  );
  return res.rows[0].profit;
};

exports.getSiteProfitGames = function*(games) {
  let res = yield* query(
    `SELECT SUM(wagered) - SUM(cashed_out) - SUM(bonus) AS profit
       FROM games WHERE id >= (SELECT MAX(id) FROM games) - $1`,
    [games]
  );
  return res.rows[0].profit;
};

exports.getMissingGames = function*(beg, end) {
  // Retrieve missing games
  let missing = yield* query(
    `SELECT array_agg(s.missing) AS missing FROM (
       SELECT num AS missing FROM generate_series($1::bigint, $2::bigint) t(num)
       LEFT JOIN games ON (t.num = games.id) WHERE games.id IS NULL) s`,
    [beg, end]
  );

  return missing.rows[0].missing;
};

exports.getUserProfit = function*(username) {
  let res = yield* query(
    `SELECT
       game_id AS game,
       SUM(COALESCE(cash_out,0) + COALESCE(bonus,0) - bet)
         OVER (ROWS UNBOUNDED PRECEDING) AS profit
     FROM plays WHERE user_id = userIdOf($1) ORDER BY game_id ASC`,
    [username]
  );
  return res.rows;
};

exports.getWageredTime = function*(time) {
  let res = yield* query(
    `SELECT SUM(wagered) wagered FROM games WHERE created >= $1`,
    [new Date(Date.now() - time)]
  );
  return res.rows[0].wagered;
};

exports.getWageredGames = function*(games) {
  let res = yield* query(
    `SELECT SUM(wagered) wagered FROM games
       WHERE id >= (SELECT MAX(id) FROM games) - $1`,
    [games]
  );
  return res.rows[0].wagered;
};
