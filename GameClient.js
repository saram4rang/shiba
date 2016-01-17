'use strict';

const _            =  require('lodash');
const EventEmitter =  require('events').EventEmitter;
const inherits     =  require('util').inherits;
const co           =  require('co');
const request      =  require('co-request');
const SocketIO     =  require('socket.io-client');
const debug        =  require('debug')('shiba:client');
const debuggame    =  require('debug')('shiba:game');
const debuguser    =  require('debug')('shiba:user');
const debugtick    =  require('debug')('verbose:tick');

const Lib          =  require('./Lib');

module.exports = Client;

function Client(config) {
  EventEmitter.call(this);

  /* User state. Possible values are
   *
   *  WATCHING
   *    During starting time, this means that the user has not yet
   *    placed a bet. During and after the game it signifies that the
   *    user is not playing / has not played in the current round.
   *
   *  PLACING
   *    Is set when the user placed a bet during the starting time in
   *    order to avoid placing multiple bets. By the time the message
   *    reaches the server the game may have already started. In that
   *    case we get a 'game_started' event and never receive a
   *    'player_bet' event for ourselves.
   *
   *  PLACED
   *    During starting time this means that the user has placed a bet
   *    and it was successfully confirmed by the server.
   *
   *  PLAYING
   *    During the playing phase this means that the user is playing
   *    in this round and has not yet cashed out.
   *
   *  CASHINGOUT
   *    User has requested the server to cashout but has not received
   *    a confirmation yet.
   *
   *  CASHEDOUT
   *    User has played and successfully cashed out.
   *
   *  CRASHED
   *    The user played in this round but didn't successfully cashout
   *    before the game crashed.
   */
  this.userState = null;

  /** This will always be the last server seed that we received. It is
   *  set on joining the game and on the game_crash event.
   */
  this.lastServerSeed = null;

  this.username  = null;
  this.balance   = null;
  this.game      = null;

  // Save configuration and stuff.
  this.config = config;

  debug("Setting up connection to %s", config.GAMESERVER);
  this.socket = SocketIO(config.GAMESERVER);
  this.socket.on('error', this.onError.bind(this));
  this.socket.on('err', this.onErr.bind(this));
  this.socket.on('connect', this.onConnect.bind(this));
  this.socket.on('disconnect', this.onDisconnect.bind(this));
  this.socket.on('game_starting', this.onGameStarting.bind(this));
  this.socket.on('game_started', this.onGameStarted.bind(this));
  this.socket.on('tick', this.onTick.bind(this));
  this.socket.on('game_tick', this.onGameTick.bind(this));
  this.socket.on('game_crash', this.onGameCrash.bind(this));
  this.socket.on('bets', this.onBets.bind(this));
  this.socket.on('player_bet', this.onPlayerBet.bind(this));
  this.socket.on('cashed_out', this.onCashedOut.bind(this));
}

inherits(Client, EventEmitter);

Client.prototype.onError = function(err) {
  console.error('onError: ', err);
};

Client.prototype.onErr = function(err) {
  console.error('onErr: ', err);
};

Client.prototype.onConnect = function(data) {
  debug("Connected.");

  let self = this;
  self.emit('connect');

  co(function*() {
    let ott = yield* getOtt(self.config);
    debug("Received one time token: " + ott);
    debug("Joining the game");

    self.socket.emit('join', {
      ott: ott,
      api_version: 1
    }, function(err, data) {
      if (err)
        console.error('[ERROR] onConnect:', err);
      else
        self.onJoin(data);
    });
  }).catch(err => console.error('[ERROR] onConnect', err));
};

Client.prototype.onDisconnect = function(data) {
  debug('Client disconnected |', data, '|', typeof data);
  this.emit('disconnect');
};

Client.prototype.onJoin = function(data) {
  /* Example 1:
       { "state" : "IN_PROGRESS",
         "player_info" : { "Steve" : {"bet":500000},
                           "Shiba" : {"bet":21600,"stopped_at":103}
                         },
         "game_id":1023470,
         "last_hash":"c7a6e51b81d78bc3f01996cf76cd64aea3cb5b7fcdea65d28f3d16c3f7622081",
         "max_win":183474675.81,
         "elapsed":3597,
         "created":"2015-01-23T22:44:06.093Z",
         "joined":[],
         "table_history": [ {"game_id":1023469,
                             "game_crash":0,
                             "created":"2015-01-23T22:43:58.025Z",
                             "player_info": {"Steve": {"bet":500000},
                                             "Shiba":{"bet":188600}
                                            },
                             "hash":"c7a6e51b81d78bc3f01996cf76cd64aea3cb5b7fcdea65d28f3d16c3f7622081"
                            }
                          ],
         "username":Steve,
         "balance_satoshis":133700
       }

     Example 2:
       { "state":"STARTING",
         "player_info":{},
         "game_id":1024781,
         "last_hash":"f0081ce965e0d8614e2c042310db60d725d98dfd8b1934aec6d35de369bd4347",
         "max_win":112105971.33,
         "elapsed":-1434,
         "created":"2015-01-24T07:48:46.261Z",
         "joined":["Steve","Shiba"],
         "table_history": [],
         "username":null,
         "balance_satoshis":null
       }
  */

  let copy =
    { state:        data.state,
      game_id:      data.game_id,
      last_hash:    data.last_hash,
      elapsed:      data.elapsed,
      username:     data.username,
      balance:      data.balance_satoshis
    };

  debug('Resetting client state\n%s', JSON.stringify(copy, null, ' '));

  this.lastServerSeed = data.last_hash;
  this.game =
    { id:              data.game_id,
      serverSeedHash:  data.last_hash,
      players:         data.player_info,
      state:           data.state,
      startTime:       new Date(data.created),
      // Valid after crashed
      crashpoint:      null,
      serverSeed:      null,
      forced:          null
    };

  for (let i = 0; i < data.joined.length; ++i) {
    this.game.players[data.joined[i]] = {};
  }

  let players = data.player_info;

  this.balance  = data.balance_satoshis;
  this.username = data.username;

  // Retrieve user state from player info
  if (!players[this.username])
    this.userState = 'WATCHING';
  else if (players[this.username].stopped_at)
    this.userState = 'CASHEDOUT';
  else if(data.state === 'ENDED')
    this.userState = 'CRASHED';
  else
    this.userState = 'PLAYING';

  this.emit('join', data);
};

Client.prototype.onGameStarting = function(data) {
  /* Example:
       { "game_id":1000020,
         "max_win":150000000,
         "time_till_start":5000
       }
  */

  debuggame('Game #%d starting', data.game_id);
  this.game =
    { id:              data.game_id,
      // The server seed hash is always the seed of the previous games.
      serverSeedHash:  this.lastServerSeed,
      players:         {},
      state:           'STARTING',
      startTime:       new Date(Date.now() + data.time_till_start),
      // Valid after crashed
      crashpoint:      null,
      serverSeed:      null,
      forced:          null
    };

  this.userState = 'WATCHING';

  // We additionally add the server seed hash here.
  data.server_seed_hash = this.game.serverSeedHash;
  this.emit('game_starting', data);
};

Client.prototype.onGameStarted = function(bets) {
  debuggame('Game #%d started', this.game.id);
  this.game.state          = 'IN_PROGRESS';
  this.game.startTime      = new Date();

  for (let username in bets) {
    if (this.username === username)
      this.balance -= bets[username];

    // TODO: simplify after server upgrade
    if (this.game.players.hasOwnProperty(username))
      this.game.players[username].bet = bets[username];
    else
      this.game.players[username] = { bet: bets[username] };
  }

  if (this.userState === 'PLACED') {
    debuguser('User state: PLACED -> PLAYING');
    this.userState = 'PLAYING';
  } else if (this.userState === 'PLACING') {
    debuguser('Bet failed.');
    debuguser('User state: PLACING -> WATCHING');
    this.userState = 'WATCHING';
  }

  this.emit('game_started', bets);
};

Client.prototype.onTick = function(data) {
  var elapsed = data[0];
  var cashouts = data[1];

  var self = this;
  _.forEach(cashouts, (stoppedAt, username) => {
    self.onCashedOut({username: username, stopped_at: stoppedAt});
  });
  self.onGameTick(elapsed);
};

/* TODO: Inline into the above after gameserver update. */
Client.prototype.onGameTick = function(elapsed) {
  // Correct startTime every tick.
  this.startTime = Math.min(this.startTime, Date.now() - elapsed);

  // Print verbose tick information
  let at   = Lib.growthFunc(elapsed);
  let line = Lib.formatFactor(at);
  line = line + " elapsed " + elapsed;

  debugtick('Tick ' + line);
  this.emit('game_tick', elapsed);
};

Client.prototype.onGameCrash = function(data) {

  /* Example:
       { "forced":false,
         "elapsed":0,
         "game_crash":0,
         "bonuses":{"Steve":42,
                    "Shiba":1337
                   },
         "hash":"20c8a18be0fb4d4529b661938350bfbea3ed822c4dc83e764a079efa14ec9af9"
       }
  */

  let crash = Lib.formatFactor(data.game_crash);
  debuggame('Game #%d crashed @%sx', this.game.id, crash);
  this.lastServerSeed  = data.hash;
  this.game.serverSeed = data.hash;
  this.game.crashPoint = data.game_crash;
  this.game.forced     = data.forced;
  this.game.state      = 'ENDED';

  // Add the bonus to each user that wins it
  for (let playerName in data.bonuses) {
    console.assert(this.game.players[playerName]);
    this.game.players[playerName].bonus = data.bonuses[playerName];
  }

  if (this.userState === 'PLAYING' ||
      this.state === 'CASHINGOUT') {
    debuguser('User state: %s -> CRASHED', this.userState);
    this.userState = 'CRASHED';
    this.emit('user_loss', data);
  }

  let gameInfo = this.getGameInfo();
  this.emit('game_crash', data, gameInfo);
};

Client.prototype.onBets = function(data) {
  this.emit('bets', data);

  for (var i = 0; i < data.length;) {
    var index    = data[i++];
    var username = data[i++];

    this.onPlayerBet({
      username: username,
      index: index
    });
  }
};

/* TODO: Inline into the above after gameserver upgrade. */
Client.prototype.onPlayerBet = function(data) {
  data.joined = new Date();
  this.game.players[data.username] = data;

  if (this.username === data.username) {
    debuguser('User state: %s -> PLACED', this.userState);
    this.userState = 'PLACED';
    this.emit('player_bet', data);
    this.emit('user_bet', data);
  } else {
    debuggame('Player bet: %s', JSON.stringify(data));
    this.emit('player_bet', data);
  }
};

Client.prototype.onCashedOut = function(data) {
  /* Example:
       { "username":"Steve",
         "stopped_at":2097
       }
  */

  console.assert(this.game.players[data.username]);
  let player = this.game.players[data.username];
  player.stopped_at = data.stopped_at;

  if (this.username === data.username) {
    debuguser('User cashout @%d: PLAYING -> CASHEDOUT', data.stopped_at);
    this.balance += player.bet * data.stopped_at / 100;
    this.userState = 'CASHEDOUT';
    this.emit('cashed_out', data);
    this.emit('user_cashed_out', data);
  } else {
    debuggame('Player cashout @%d: %s', data.stopped_at, data.username);
    this.emit('cashed_out', data);
  }
};

Client.prototype.doBet = function(amount, autoCashout) {
  debuguser('Bet: %d @%d', amount, autoCashout);

  if (this.userState !== 'WATCHING')
    return console.error('Cannot place bet in state: ' + this.userState);

  this.userState = 'PLACING';
  this.socket.emit('place_bet', amount, autoCashout, function(err) {
    if (err) console.error('Place bet error:', err);
  });
};

Client.prototype.doCashout = function() {
  debuguser('Cashing out');
  if (this.userState !== 'PLAYING' &&
      this.userState !== 'PLACING' &&
      this.userState !== 'PLACED')
    return console.error('Cannot cashout in state: ' + this.userState);

  this.userState = 'CASHINGOUT';
  this.socket.emit('cash_out', function(err) {
    if (err) console.error('Cashing out error:', err);
  });
};

Client.prototype.timeTillStart = function() {
  return this.startTime - Date.now();
};

Client.prototype.getPlayers = function() {
  return this.game.players;
};

Client.prototype.getGameInfo = function() {
  let gameInfo =
    { elapsed:          Date.now() - this.game.startTime,
      game_id:          this.game.id,
      server_seed_hash: this.game.serverSeedHash,
      player_info:      this.game.players,
      state:            this.game.state,
      started:          this.game.startTime
    };

  if (this.game.state === 'ENDED') {
    let cp   = Lib.crashPoint(this.game.serverSeed);
    let diff = Math.abs(cp - this.game.crashPoint);

    gameInfo.game_crash  = this.game.crashPoint;
    gameInfo.server_seed = this.game.serverSeed;

    // The crashpoint calculation is a floating point calculation and as such
    // is imprecise. Above 1,000,000x we allow the crashpoint to differ by
    // 0.08x, below it must be equal.
    gameInfo.verified    =
      diff === 0 || cp > 1e6 && diff < 0.08 ? "ok" : "scam";
  }

  return gameInfo;
};

// Get a one time token from the server to join the game.
function* getOtt(config) {
  if (!config.SESSION) return null;

  debug("Requesting one time token");

  let cookie = request.cookie('id=' + config.SESSION);
  let url    = config.WEBSERVER + '/ott';
  let jar    = request.jar();
  jar.setCookie(cookie, url);

  let res = yield request.post({url:url, jar:jar});
  return res.body;
}
