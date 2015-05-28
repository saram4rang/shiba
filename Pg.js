'use strict';

const assert   = require('assert');
const parallel = require('co-parallel');
const pg       = require('co-pg')(require('pg'));
const debug    = require('debug')('shiba:db');
const debugpg  = require('debug')('shiba:db:pg');

const Cache  = require('./Util/Cache');
const Config = require('./Config');
const Lib    = require('./Lib');

pg.defaults.poolSize        = 3;
pg.defaults.poolIdleTimeout = 500000;

pg.types.setTypeParser(20, function(val) { // parse int8 as an integer
  return val === null ? null : parseInt(val);
});

let querySeq = 0;
function *query(sql, params) {
  let qid = querySeq++;
  debugpg("[%d] Executing query '%s'", qid, sql);
  if (params) debugpg("[%d] Parameters %s", qid, JSON.stringify(params));

  let vals   = yield pg.connectPromise(Config.DATABASE);
  let client = vals[0];
  let done   = vals[1];
  let result = yield client.queryPromise(sql, params);

  // Release client back to pool
  done();
  debugpg("[%d] Finished query", qid);

  return result;
}

/**
 * Runs a session and retries if it deadlocks.
 *
 * @param {String} runner A generator expecting a query function.
 * @return Session result.
 * @api private
 */
function* withClient(runner) {

  let vals   = yield pg.connectPromise(Config.DATABASE);
  let client = vals[0];
  let done   = vals[1];

  let query =
        function*(sql,params) {
          let qid = querySeq++;
          debugpg("[%d] Executing query '%s'", qid, sql);
          if (params) debugpg("[%d] Parameters %s", qid, JSON.stringify(params));

          let result = yield client.queryPromise(sql, params);
          debugpg("[%d] Finished query", qid);
          return result;
        };

  try {
    let result = yield runner(query);
    done();
    return result;
  } catch (ex) {
    console.log(ex);
    console.log(ex.stack);
    if (ex.removeFromPool) {
      console.error('[INTERNAL_ERROR] removing connection from pool after getting ', ex);
      done(new Error('Removing connection from pool'));
      throw ex;
    } else if (ex.code === '40P01') { // Deadlock
      done();
      return yield withClient(runner);
    } else {
      done();
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
 * @return Transaction result.
 * @api private
 */
function* withTransaction(runner) {

  return yield withClient(function*(query) {
    let txid = txSeq++;
    try {
      debug('[%d] Starting transaction', txid);
      yield query('BEGIN');
      let result = yield runner(query);
      debug('[%d] Committing transaction', txid);
      yield query('COMMIT');
      debug('[%d] Finished transaction', txid);
      return result;
    } catch (ex) {
      try {
        yield query('ROLLBACK');
      } catch(ex) {
        ex.removeFromPool = true;
        throw ex;
      }
      throw ex;
    }
  });
}

function* getOrCreateUser(username) {
  debug('GetOrCreateUser user: ' + username);

  return yield withTransaction(function*(query) {
    let sql = 'SELECT * FROM users WHERE lower(username) = lower($1)';
    let par = [username];

    let result = yield query(sql, par);

    if (result.rows.length > 0) {
      // User exists. Return the first (and only) row.
      assert(result.rows.length === 1);
      return result.rows[0];
    }

    // Create new user.
    sql = 'INSERT INTO users(username) VALUES($1) RETURNING username, id';
    par = [username];

    result = yield query(sql, par);
    assert(result.rows.length === 1);
    return result.rows[0];
  });
}

function* getExistingUser(username) {
  debug('Getting user: ' + username);

  if (Lib.isInvalidUsername(username))
    throw 'USERNAME_INVALID';

  let sql = 'SELECT * FROM users WHERE lower(username) = lower($1)';
  let par = [username];

  let data = yield query(sql, par);

  if (data.rows.length > 0) {
    // User exists. Return the first (and only) row.
    assert(data.rows.length === 1);
    return data.rows[0];
  } else {
    throw 'USER_DOES_NOT_EXIST';
  }
}

const userCache = new Cache({
  maxAge: 1000 * 60 * 10, // 10 minutes
  load : getOrCreateUser
});

function* getUser(username) {
  if (Lib.isInvalidUsername(username))
    throw 'USERNAME_INVALID';

  try {
    return yield userCache.get(username);
  } catch(err) {
    console.error('[Pg.getUser] ERROR:', err);
    throw err;
  }
}

/*
CREATE TABLE chats (
  id bigint NOT NULL.
  user_id bigint NOT NULL,
  message text NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
*/
exports.putChat = function*(username, message, timestamp) {
  debug('Recording chat message. User: ' + username);
  let user = yield getUser(username);

  let sql = 'INSERT INTO chats(user_id, message, created) VALUES ($1, $2, $3)';
  let par = [user.id, message, timestamp];
  yield query(sql, par);
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
exports.putMute = function*(username, moderatorname, timespec, shadow, timestamp) {
  debug('Recording mute message.' +
        ' User: ' + username + '.' +
        ' Moderator: ' + moderatorname);

  let vals = yield parallel([getUser(username), getUser(moderatorname)]),
      usr  = vals[0],
      mod  = vals[1],
      sql  =
        'INSERT INTO ' +
        'mutes(user_id, moderator_id, timespec, shadow, created) ' +
        'VALUES ($1, $2, $3, $4, $5)',
      par  = [usr.id, mod.id, timespec, shadow, timestamp];
  yield query(sql, par);
};

exports.putUnmute = function*(username, moderatorname, shadow, timestamp) {
  debug('Recording unmute message.' +
        ' User: ' + username + '.' +
        ' Moderator: ' + moderatorname);

  let vals = yield parallel([getUser(username), getUser(moderatorname)]);
  let usr  = vals[0];
  let mod  = vals[1];

  let sql =
    'INSERT INTO ' +
    'unmutes(user_id, moderator_id, shadow, created) ' +
    'VALUES ($1, $2, $3, $4)';
  let par = [usr.id, mod.id, shadow, timestamp];
  yield query(sql, par);
};

exports.putMsg = function*(msg) {
  switch(msg.type) {
  case 'say':
    yield this.putChat(msg.username, msg.message, new Date(msg.time));
    break;
  case 'mute':
    yield this.putMute(
      msg.username, msg.moderator, msg.timespec,
      msg.shadow, new Date(msg.time));
    break;
  case 'unmute':
    yield this.putUnmute(
      msg.username, msg.moderator, msg.shadow,
      new Date(msg.time));
    break;
  case 'error':
  case 'info':
    break;
  default:
    throw 'UNKNOWN_MSG_TYPE';
  }
};

exports.putGame = function*(info) {
  let players = Object.keys(info.player_info);

  // Step1: Resolve all player names.
  let users   = yield parallel(players.map(getUser));
  let userIds = {};
  for (let i in users)
    userIds[users[i].username] = users[i].id;

  // Insert into the games and plays table in a common transaction.
  debug('Recording info for game #' + info.game_id);
  yield withTransaction(function*(query) {
    debugpg('Inserting game data for game #' + info.game_id);

    let sql =
      'INSERT INTO ' +
      'games(id, game_crash, seed) ' +
      'VALUES ($1, $2, $3)';
    let par =
      [ info.game_id,
        info.game_crash,
        info.server_seed
      ];
    yield query(sql, par);

    yield parallel(players.map(function*(player){
      debugpg('Inserting play for ' + player);

      let play = info.player_info[player];
      let sql =
        'INSERT INTO ' +
        'plays(user_id, cash_out, game_id, bet, bonus) ' +
        'VALUES ($1, $2, $3, $4, $5)';
      let par =
        [ userIds[player],
          play.stopped_at ? Math.round(play.bet * play.stopped_at / 100) : null,
          info.game_id,
          play.bet,
          play.bonus || null
        ];

      try {
        yield query(sql, par);
      } catch(err) {
        console.error('Insert play failed. Values:', play);
        throw err;
      }
    }));
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

  let vals    = yield parallel([getUser(username), getUser(creatorname)]);
  let user    = vals[0];
  let creator = vals[1];

  let sql =
    'INSERT INTO ' +
    'licks(user_id, message, creator_id) ' +
    'VALUES ($1, $2, $3)';
  let par = [user.id, message, creator.id];
  yield query(sql, par);
};

exports.getLick = function*(username) {
  debug('Getting custom lick messages for user: ' + username);
  let user = getExistingUser(username);

  let sql   = 'SELECT message FROM licks WHERE user_id = $1';
  let par   = [user.id];
  let data  = yield query(sql, par);
  let licks = data.rows.map(row => row.message);

  return {username: user.username, licks: licks};
};

exports.getCrash = function*(qry) {
  debug('Getting last crashpoint: ' + JSON.stringify(qry));
  let sql, par;
  if (qry === 'MAX') {
    sql = 'SELECT * FROM games WHERE id =' +
          ' (SELECT id FROM game_crashes' +
          '   ORDER BY game_crash DESC LIMIT 1)';
    par = [];
  } else {
    let min   = qry.hasOwnProperty('min') ? ' AND game_crash >= ' + qry.min : '';
    let max   = qry.hasOwnProperty('max') ? ' AND game_crash <= ' + qry.max : '';
    let range = 'TRUE' + min + max;
    sql = 'SELECT * FROM games WHERE id =' +
          ' (SELECT id FROM game_crashes' +
          '   WHERE ' + range +
          '   ORDER BY id DESC LIMIT 1)';
    par = [];
  }

  try {
    let data = yield query(sql, par);
    return data.rows;
  } catch(err) {
    console.error(err);
    throw err;
  }
};

exports.addAutomute = function*(creator, regex) {
  regex = regex.toString();
  debug('Adding automute ' + regex);

  let user = yield getUser(creator);
  let sql  = 'INSERT INTO automutes(creator_id, regexp) VALUES($1, $2)';
  let par  = [user.id, regex];

  try {
    yield query(sql, par);
  } catch(err) {
    console.error(err);
    throw err;
  }
};

exports.getAutomutes = function*() {
  debug('Getting automute list.');
  let sql = 'SELECT regexp FROM automutes WHERE enabled';
  let par = [];

  let data = yield query(sql, par);

  let reg = /^\/(.*)\/([gi]*)$/;
  let res = data.rows.map(row => {
    let match = row.regexp.match(reg);
    return new RegExp(match[1], match[2]);
  });

  return res;
};

exports.getLastSeen = function*(username) {
  debug('Getting last chat message of user ' + username);

  let user = getExistingUser(username);

  let sql =
    'SELECT created FROM chats WHERE user_id = $1 ' +
    'ORDER BY created DESC LIMIT 1';
  let par  = [user.id];
  let data = yield query(sql, par);

  if (data.rows.length > 0) {
    // Return the first (and only) row.
    assert(data.rows.length === 1);
    return {
      username: user.username,
      time:     new Date(data.rows[0].created)
    };
  } else {
    // User never said anything.
    return {username: user.username};
  }
};

exports.getLatestBlock = function*() {
  console.log('Getting last block from DB');
  let sql = 'SELECT * FROM blocks ORDER BY height DESC LIMIT 1';
  let par = [];

  let data = yield query(sql, par);
  return data.rows[0];
};

exports.putBlock = function*(block) {
  let sql = 'INSERT INTO blocks(height, hash) VALUES($1, $2)';
  let par = [block.height, block.hash];

  try {
    yield query(sql, par);
  } catch(err) {
    // Ignore unique_violation code 23505.
    if (err.code !== 23505 && err.code !== '23505') throw err;
  }
};

exports.getBlockNotifications = function*() {
  debug('Getting block notification list');
  let sql  = 'SELECT * FROM blocknotifications';
  let par  = [];
  let data = yield query(sql, par);

  return data.rows.map(row => row.username);
};

exports.putBlockNotification = function*(username) {
  debug('Adding %s to block notification list', username);
  let sql = 'INSERT INTO blocknotifications(username) VALUES($1)';
  let par = [username];

  try {
    yield query(sql, par);
  } catch(err) {
    // Ignore unique_violation code 23505.
    if (err.code !== 23505 && err.code !== '23505') throw err;
  }
};

exports.clearBlockNotifications = function*() {
  debug('Clearing block notification list');
  let sql = 'DELETE FROM blocknotifications';
  let par = [];
  yield query(sql, par);
};
