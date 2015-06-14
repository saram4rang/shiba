'use strict';

const debug       = require('debug')('shiba:cmd:bust');
const BustParser = require('./BustParser').parser;
const Lib         = require('../Lib');
const Pg          = require('../Pg');

function Bust() {
}

Bust.prototype.handle = function*(client, msg, input) {

  let qry;
  try {
    qry = BustParser.parse(input);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  debug('Bust parse result: ' + JSON.stringify(qry));

  let res;
  try {
    res = yield* Pg.getBust(qry);
  } catch(err) {
    console.error('[ERROR] onCmdBust', err.stack);
    client.doSay('wow. such database fail');
    return;
  }

  // Assume that we have never seen this crashpoint.
  if(res.length === 0) {
    client.doSay('wow. such absence. never seen ' + input);
    return;
  }

  res = res[0];
  let time = new Date(res.created);
  let diff = Date.now() - time;
  let info = client.getGameInfo();
  let line =
    'Seen ' + Lib.formatFactorShort(res.game_crash) +
    ' in #' +  res.id +
    '. ' + (info.game_id - res.id) +
    ' games ago (' + Lib.formatTimeDiff(diff) +
    ')';
  client.doSay(line);
};

module.exports = exports = Bust;
