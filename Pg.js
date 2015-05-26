var AsyncCache = require('async-cache');
var async      = require('async');
var assert     = require('better-assert');
var pg         = require('pg');
var debug      = require('debug')('shiba:db');
var debugpg    = require('debug')('shiba:db:pg');
var Config     = require('./Config')
var Lib        = require('./Lib');

pg.defaults.poolSize        = 3;
pg.defaults.poolIdleTimeout = 500000;

pg.types.setTypeParser(20, function(val) { // parse int8 as an integer
  return val === null ? null : parseInt(val);
});

// cb is called with (err, client, done)
function connect(cb) {
  return pg.connect(Config.DATABASE, cb);
}

function query(query, params, cb) {
  //third parameter is optional
  if (typeof params == 'function') {
    cb = params;
    params = [];
  }

  doIt();
  function doIt() {
    connect(function(err, client, done) {
      if (err) return cb(err);
      client.query(query, params, function(err, result) {
        done();
        if (err) {
          if (err.code === '40P01') {
            console.warn('Warning: Retrying deadlocked transaction: ', query, params);
            return doIt();
          }
          return cb(err);
        }

        cb(null, result);
      });
    });
  }
}

exports.query = query;

// TRANSACTION HANDLING
//   The transaction function implements the boilerplate for
//   running a transaction and retying if need be.
//
//   The runner parameter is a function that takes (client, callback)
//   and performs all queries for the intended transaction. The
//   callback should be called with (err, data). Inside the runner
//   function, the client should not be used to commit, rollback or
//   start a new transaction
function transaction(runner, cb) {
  debugpg('Starting transaction');
  doIt();

  function doIt() {
    connect(function (err, client, done) {
      if (err) return cb(err);

      function rollback(err) {
        client.query('ROLLBACK', done);

        if (err.code === '40P01') {
          console.warn('Warning: Retrying deadlocked transaction..');
          return doIt();
        }
        cb(err);
      }

      client.query('BEGIN', function (err) {
        debugpg('Transaction begin');
        if (err) return rollback(err);

        runner(client, function (err, data) {
          if (err)
            return rollback(err);

          client.query('COMMIT', function (err) {
            if (err) return rollback(err);

            debugpg('Transaction commited');
            done();
            cb(null, data);
          });
        });
      });
    });
  }
}

function getOrCreateUser(username, cb) {
  debug('Getting user: ' + username);

  if (Lib.isInvalidUsername(username))
    return cb('USERNAME_INVALID');

  transaction(function(client, cb) {
    var q = 'SELECT * FROM users WHERE lower(username) = lower($1)';
    var p = [username];

    client.query(q, p, function(err, data) {
      if (err) return cb(err);

      if (data.rows.length > 0) {
        // User exists. Return the first (and only) row.
        assert(data.rows.length == 1);
        cb(null, data.rows[0]);
      } else {
        // Create new user.
        var q = 'INSERT INTO users(username) VALUES($1) RETURNING username, id';
        var p = [username];
        client.query(q, p, function(err, data) {
          if (err) return cb(err);

          assert(data.rows.length === 1);
          cb(null, data.rows[0]);
        });
      }
    });
  }, cb);
};

function getExistingUser(username, cb) {
  debug('Getting user: ' + username);

  if (Lib.isInvalidUsername(username))
    return cb('USERNAME_INVALID');

  var q = 'SELECT * FROM users WHERE lower(username) = lower($1)';
  var p = [username];

  query(q, p, function(err, data) {
    if (err) return cb(err);

    if (data.rows.length > 0) {
      // User exists. Return the first (and only) row.
      assert(data.rows.length == 1);
      cb(null, data.rows[0]);
    } else {
      cb('USER_DOES_NOT_EXIST');
    }
  });
};

var userCache = new AsyncCache({
  maxAge: 1000 * 60 * 10, // 10 minutes
  load : getOrCreateUser
});

function getUser(username, cb) {
  if (Lib.isInvalidUsername(username))
    return cb('USERNAME_INVALID');
  return userCache.get.bind(userCache);
}

/*
CREATE TABLE chats (
  id bigint NOT NULL.
  user_id bigint NOT NULL,
  message text NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
*/
exports.putChat = function(username, message, timestamp, cb) {
  debug('Recording chat message. User: ' + username);
  getUser(username, function(err, user) {
    if (err) return cb && cb(err);

    var q = 'INSERT INTO chats(user_id, message, created) VALUES ($1, $2, $3)';
    var p = [user.id, message, timestamp];
    query(q, p, function(err) {
      if (err) return cb && cb(err);
      return cb && cb(null);
    });
  });
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
exports.putMute = function(username, moderatorname, timespec, shadow, timestamp, cb) {
  debug('Recording mute message.' +
        ' User: ' + username + '.' +
        ' Moderator: ' + moderatorname);

  async.map([username, moderatorname], getUser, function (err, vals) {
    if (err) return cb && cb(err);
    var usr = vals[0];
    var mod = vals[1];

    var q =
      'INSERT INTO ' +
      'mutes(user_id, moderator_id, timespec, shadow, created) ' +
      'VALUES ($1, $2, $3, $4, $5)';
    var p = [usr.id, mod.id, timespec, shadow, timestamp];
    query(q, p, function(err) {
      if (err) return cb && cb(err);
      return cb && cb(null);
    });
  });
};

exports.putUnmute = function(username, moderatorname, shadow, timestamp, cb) {
  debug('Recording unmute message.' +
        ' User: ' + username + '.' +
        ' Moderator: ' + moderatorname);

  async.map([username, moderatorname], getUser, function (err, vals) {
    if (err) return cb && cb(err);
    var usr = vals[0];
    var mod = vals[1];

    var q =
      'INSERT INTO ' +
      'unmutes(user_id, moderator_id, shadow, created) ' +
      'VALUES ($1, $2, $3, $4)';
    var p = [usr.id, mod.id, shadow, timestamp];
    query(q, p, function(err) {
      if (err) return cb && cb(err);
      return cb && cb(null);
    });
  });
};

exports.putMsg = function(msg, cb) {
  switch(msg.type) {
  case 'say':
    return this.putChat(msg.username, msg.message, new Date(msg.time), cb);
  case 'mute':
    return this.putMute(
      msg.username, msg.moderator, msg.timespec,
      msg.shadow, new Date(msg.time), cb);
  case 'unmute':
    return this.putUnmute(
      msg.username, msg.moderator, msg.shadow,
      new Date(msg.time), cb);
  case 'error':
  case 'info':
    return cb && cb(null);
  default:
    return cb && cb('UNKNOWN_MSG_TYPE');
  }
};

exports.putGame = function(info, cb) {
  debug('Recording info for game #' + info.game_id);
  var players = Object.keys(info.player_info);

  // Step1: Resolve all player names.
  async.map(players, getUser, function (err, users) {
    if (err) return cb(err);

    var userIds = {};
    for (var i = 0; i < users.length; ++i)
      userIds[users[i].username] = users[i].id;

    // Insert into the games and plays table in a common transaction.
    transaction(function(client, cb) {
      debugpg('Inserting game data for game #' + info.game_id);

      var q =
        'INSERT INTO ' +
        'games(id, game_crash, seed) ' +
        'VALUES ($1, $2, $3)';
      var p = [ info.game_id,
                info.game_crash,
                info.server_seed
              ];
      client.query(q, p, function (err) {
        if (err) return cb && cb(err);

        function putPlay(player, cb) {
          debugpg('Inserting play for ' + player);
          var play = info.player_info[player];
          var q =
            'INSERT INTO ' +
            'plays(user_id, cash_out, game_id, bet, bonus) ' +
            'VALUES ($1, $2, $3, $4, $5)';
          var p = [ userIds[player],
                    play.stopped_at ? Math.round(play.bet * play.stopped_at / 100) : null,
                    info.game_id,
                    play.bet,
                    play.bonus || null
                  ];
          client.query(q, p, function(err) {
            if (err) console.error('Insert play failed. Values:', play);
            cb && cb(err);
          });
        }

        async.eachSeries(players, putPlay, cb);
      });
    }, cb);
  });
};

/* Like the above, but only import the information about players. */
exports.putPlays = function(info, cb) {
  debug('Recording info for game #' + info.game_id);
  var players = Object.keys(info.player_info);

  // Step1: Resolve all player names.
  async.map(players, getUser, function (err, users) {
    if (err) return cb(err);

    var userIds = {};
    for (var i = 0; i < users.length; ++i)
      userIds[users[i].username] = users[i].id;

    // Insert into the games and plays table in a common transaction.
    transaction(function(client, cb) {
      function putPlay(player, cb) {
        debugpg('Inserting play for ' + player);
        var play = info.player_info[player];
        var q =
          'INSERT INTO ' +
          'plays(user_id, cash_out, game_id, bet, bonus) ' +
          'VALUES ($1, $2, $3, $4, $5)';
        var p = [ userIds[player],
                  play.stopped_at ? Math.round(play.bet * play.stopped_at / 100) : null,
                  info.game_id,
                  play.bet,
                  play.bonus || null
                ];
        client.query(q, p, function(err) {
          if (err) console.error('Insert play failed. Values:', play);
          cb && cb(err);
        });
      }

      async.eachSeries(players, putPlay, cb);
    }, cb);
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
exports.putLick = function(username, message, creatorname, cb) {
  debug('Recording custom lick message for user: ' + username);
  async.map([username, creatorname], getUser, function (err, vals) {
    var user = vals[0];
    var creator = vals[1];

    var q =
      'INSERT INTO ' +
      'licks(user_id, message, creator_id) ' +
      'VALUES ($1, $2, $3)';
    var p = [user.id, message, creator.id];
    query(q, p, function(err) {
      if (err) return cb(err);
      return cb && cb(null);
    });
  });
};

exports.getLick = function(username, cb) {
  debug('Getting custom lick messages for user: ' + username);
  getExistingUser(username, function (err, user) {
    if (err) { console.error(err); return cb(err); };

    var q = 'SELECT message FROM licks WHERE user_id = $1';
    var p = [user.id];
    query(q, p, function(err, data) {
      if (err) return cb(err);
      var licks = [];
      for (var i = 0; i < data.rows.length; ++ i) {
        licks.push(data.rows[i].message);
      }
      return cb(null, {username: user.username, licks: licks});
    });
  });
};

exports.getCrash = function(qry, cb) {
  debug('Getting last crashpoint: ' + JSON.stringify(qry));
  if (qry == 'MAX') {
    var q = 'SELECT * FROM games WHERE id =' +
            ' (SELECT id FROM game_crashes' +
            '   ORDER BY game_crash DESC LIMIT 1)';
    var p = [];
  } else {
    var min   = qry.hasOwnProperty('min') ? ' AND game_crash >= ' + qry.min : '';
    var max   = qry.hasOwnProperty('max') ? ' AND game_crash <= ' + qry.max : '';
    var range = 'TRUE' + min + max;
    var q = 'SELECT * FROM games WHERE id =' +
            ' (SELECT id FROM game_crashes' +
            '   WHERE ' + range +
            '   ORDER BY id DESC LIMIT 1)';
    var p = [];
  }

  query(q, p, function(err, data) {
    if (err) { console.error(err); return cb(err); };
    return cb(null, data.rows);
  });
};

exports.addAutomute = function(creator, regex, cb) {
  regex = regex.toString();
  debug('Adding automute ' + regex);

  getUser(creator, function(err, user) {
    if (err) return cb && cb(err);

    var q = 'INSERT INTO automutes(creator_id, regexp) VALUES($1, $2)';
    var p = [user.id, regex];

    query(q, p, function(err, data) {
      if (err) { console.error(err); return cb(err); };
      return cb(null);
    });
  });
};

exports.getAutomutes = function(cb) {
  debug('Getting automute list.');
  var q = 'SELECT regexp FROM automutes WHERE enabled';
  var p = [];

  query(q, p, function(err, data) {
    if (err) { console.error(err); return cb(err); };

    var reg = /^\/(.*)\/([gi]*)$/;
    var res = [];
    for (var i = 0; i < data.rows.length; ++i) {
      var match = data.rows[i].regexp.match(reg);
      res.push(new RegExp(match[1], match[2]));
    }
    return cb(null, res);
  });
};

exports.getLastSeen = function(username, cb) {
  debug('Getting last chat message of user ' + username);

  getExistingUser(username, function(err, user) {
    if (err) { console.error(err); return cb(err); };

    var q =
      'SELECT created FROM chats WHERE user_id = $1 ' +
      'ORDER BY created DESC LIMIT 1';
    var p = [user.id];

    query(q, p, function(err, data) {
      if (err) { console.error(err); return cb(err); };

      if (data.rows.length > 0) {
        // Return the first (and only) row.
        assert(data.rows.length == 1);
        var result =
          { username: user.username,
            time:     new Date(data.rows[0].created)
          };

        cb(null, result);
      } else {
        // User never said anything.
        cb(null, {username: user.username});
      }
    });
  });
};

exports.getLatestBlock = function(cb) {
  var q = 'SELECT * FROM blocks ORDER BY height DESC LIMIT 1';
  var p = [];

  query(q, p, function(err, data) {
    if (err) { console.error(err); return cb(err); };
    cb(null, data.rows[0]);
  });
};

exports.putBlock = function(block, cb) {
  var q = 'INSERT INTO blocks(height, hash) VALUES($1, $2)';
  var p = [block.height, block.hash];
  query(q, p, function(err) {
    // Ignore unique_violation code 23505.
    err && err.code == 23505 ? cb(null) : cb(err);
  });
};

exports.getBlockNotifications = function(cb) {
  debug('Getting block notification list');
  var q = 'SELECT * FROM blocknotifications';
  var p = [];
  query(q, p, function(err, data) {
    if (err) return cb(err);
    var result = [];
    data = data.rows;
    for (var i = 0; i < data.length; ++i)
      result.push(data[i].username);
    cb(null, result);
  });
};

exports.putBlockNotification = function(username, cb) {
  debug('Adding %s to block notification list', username);
  var q = 'INSERT INTO blocknotifications(username) VALUES($1)';
  var p = [username];
  query(q, p, function(err) {
    // Ignore unique_violation code 23505.
    err && err.code == 23505 ? cb(null) : cb(err);
  });
};

exports.clearBlockNotifications = function(cb) {
  debug('Clearing block notification list');
  var q = 'DELETE FROM blocknotifications';
  var p = [];
  query(q, p, cb);
};
