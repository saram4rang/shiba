'use strict';

const co      = require('co');
const request = require('co-request');
const debug   = require('debug')('shiba:import');

const Config  = require('./Config');
const Pg      = require('./Pg');
const pg      = require('pg');

function* getGameInfo(id) {

  let url = Config.WEBSERVER + '/game/' + id + '.json';
  let res = yield request(url);

  if (res.statusCode != 200)
    throw 'INVALID_STATUSCODE';

  return JSON.parse(res.body);
}

function* importGame(id) {
  let info;
  try {
    info = yield* getGameInfo(id);
  } catch(err) {
    console.error('Downloading game #' + id, 'failed');
    throw err;
  }

  info.created = new Date(info.created).getTime();
  info.startTime = info.created + 5000;
  try {
    yield* Pg.putGame(info);
  } catch(err) {
    console.error('Importing game #' + info.game_id, 'failed');
    throw err;
  }

  console.log('Imported game #' + info.game_id);
}

co(function* () {
  try {
    let ids = yield* Pg.getMissingGames();
    for (let id of ids)
      yield* importGame(id);
  } catch(err) {
    console.log('Caught error:', err);
    throw err;
  }

  pg.end();
});
