'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const request      = require('co-request');
const wait         = require('co-wait');
const debug        = require('debug')('shiba:store:game');
const debugv       = require('debug')('verbose:store:game');
const Config       = require('../Config');
const Pg           = require('../Pg');

function GameStore(store) {
  debug('Initializing game store');
  debugv('Initial store: %s', JSON.stringify(store, null, ' '));

  EventEmitter.call(this);

  // This array holds all the game infos sorted from old to new.
  this.store = store || [];
}

inherits(GameStore, EventEmitter);

GameStore.prototype.addGame = function*(game) {
  debug('Adding game: ' + JSON.stringify(game));

  // Try up to 5 times to log the game
  for (let i = 1; i <= 5; ++i) {
    try {
      yield* Pg.putGame(game);
      break;
    } catch(err) {
      console.error(`Failed to log game: ${game.game_id} try: ${i}`);
      console.error(`Error: ${err && err.stack || err}`);
    }
  }

  if (this.store.length > Config.GAME_HISTORY)
    this.store.shift();

  this.store.push(game);
  this.emit('game', game);
};

function* getGameInfo(id) {
  let url = Config.WEBSERVER + '/game/' + id + '.json';
  let res = yield request(url);

  if (res.statusCode !== 200) {
    console.error("Got status code:", res.statusCode);
    console.error("Body:", res.body);
    throw 'INVALID_STATUSCODE';
  }

  return JSON.parse(res.body);
}

GameStore.prototype.importGame = function*(id) {
  debug('Importing game: %d', id);
  let info;
  try {
    info = yield* getGameInfo(id);
  } catch(err) {
    console.error('Downloading game #' + id, 'failed');
    throw err;
  }

  info.created = new Date(info.created).getTime();
  // TODO: move this constant
  info.startTime = info.created + 5000;

  // Try up to 5 times to import the game
  for (let i = 1; i <= 5; ++i) {
    try {
      yield* Pg.putGame(info);
      break;
    } catch(err) {
      if (i == 5) {
        console.error('Importing game #' + info.game_id, 'failed');
        throw err;
      }
    }
  }
};

GameStore.prototype.fillMissing = function*(data) {
  debug('Checking for missing games before: %d', data.game_id);

  let maxGameId = data.state === 'ENDED' ? data.game_id : data.game_id - 1;

  // Get ids of missing games. TODO: move this constants
  let ids = yield* Pg.getMissingGames(3190000, maxGameId);

  // Import them from the web.
  for (let id of ids) {
    debug('Importing missing id: %d', id);
    try {
      yield* this.importGame(id);
    } catch(err) {
      // Message error but continue. Could be an unterminated game.
      console.error('Error while importing game %d:', id, err.stack || err);
    }
    yield wait(1500);
  }

  // Finally replace the store with the current games. TODO: Yes, there is a
  // race condition here, but this store isn't really used anyway...
  this.store = yield* Pg.getLastGames();
};

function* make() {
  debug('Create game store');
  let games = yield* Pg.getLastGames();
  return new GameStore(games);
}

module.exports = exports = make;
