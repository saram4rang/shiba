'use strict';

const debug       = require('debug')('shiba:cmd:crash');
const CrashParser = require('./CrashParser').parser;
const Lib         = require('../Lib');
const Pg          = require('../Pg');

module.exports = exports = Crash;

function Crash() {
}

Crash.prototype.init = function*() {
};

Crash.prototype.handle = function*(client, msg, input) {

  let qry;
  try {
    qry = CrashParser.parse(input);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  debug('Crash parse result: ' + JSON.stringify(qry));

  let res;
  try {
    res = yield* Pg.getCrash(qry);
  } catch(err) {
    console.error('[ERROR] onCmdCrash', err.stack);
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
