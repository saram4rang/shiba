'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const debug        = require('debug')('shiba:store:game');
const debugv       = require('debug')('verbose:store:game');
const Config       = require('../Config');
const Pg           = require('../Pg');

function GameStore(store, writeToDb) {
  debug('Initializing game store');
  debugv('Initial store: %s', JSON.stringify(store, null, ' '));

  EventEmitter.call(this);

  // This array holds all the game infos sorted from old to new.
  this.store = store || [];
  this.writeToDb = writeToDb;
}

inherits(GameStore, EventEmitter);

GameStore.prototype.mergeGames = function*(games) {

  let self = this;
  let na   = games, oa = this.store;
  let m    = [];
  let ni   = 0, oi = 0;

  while (true) {
    if (!(oi < oa.length)) {
      // No more old messages just import the new ones.
      let games = na.splice(ni);
      if (games.length > 0)
        debug('Importing new games: %s', JSON.stringify(games, null, ' '));

      this.store = m;
      for (let game of games)
        yield* this.addGame(game);
      return;
    }

    // Extract old and new game infos.
    let og = oa[oi], ng = na[ni];

    if (og.game_id < ng.game_id) {
      debugv('Merge old game: %s', JSON.stringify(og));
      m.push(og);
      oi++;
      continue;
    } else if (ng.game_id < og.game_id) {
      debugv('Merge new game: %s', JSON.stringify(ng));
      try {
        if (self.writeToDb)
          yield* Pg.putGame(ng);
      } catch(err) {
        console.error('Failed to log game:', ng, '\nError:', err);
      }
      m.push(ng);
      ni++;
      continue;
    } else {
      debugv('Merge common game: %s', JSON.stringify(og));
      m.push(og);
      oi++;
      ni++;
      continue;
    }
  }
};

GameStore.prototype.addGame = function*(game) {
  delete game.ticks;
  debug('Adding game: ' + JSON.stringify(game));

  try {
    if (this.writeToDb)
      yield* Pg.putGame(game);
  } catch(err) {
    console.error('Failed to log game:', game, '\nError:', err);
  }

  if (this.store.length > Config.GAME_HISTORY)
    this.store.shift();

  this.store.push(game);
  this.emit('game', game);
};

function* make(writeToDb) {
  debug('Create game store');
  let games = yield* Pg.getLastGames();
  return new GameStore(games, writeToDb);
}

module.exports = exports = make;
