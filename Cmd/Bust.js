'use strict';

const debug       = require('debug')('shiba:cmd:bust');
const BustParser = require('./BustParser').parser;
const Lib         = require('../Lib');
const Pg          = require('../Pg');

function Bust() {
}

Bust.prototype.handle = function*(chatClient, gameClient, msg, input) {

  let qry;
  try {
    qry = BustParser.parse(input);
  } catch(err) {
    chatClient.doSay('wow. very usage failure. such retry', msg.channelName);
    return;
  }

  debug('Bust parse result: ' + JSON.stringify(qry));

  let res;
  try {
    res = yield* Pg.getBust(qry);
  } catch(err) {
    console.error('[ERROR] onCmdBust', err.stack);
    chatClient.doSay('wow. such database fail', msg.channelName);
    return;
  }

  // Assume that we have never seen this crashpoint.
  if(res.length === 0) {
    chatClient.doSay('wow. such absence. never seen ' + (qry.text || input), msg.channelName);
    return;
  }

  res = res[0];
  let time = new Date(res.created);
  let diff = Date.now() - time;
  let info = gameClient.getGameInfo();
  let line =
    'Seen ' + Lib.formatFactorShort(res.game_crash) +
    ' in #' +  res.id +
    '. ' + (info.game_id - res.id) +
    ' games ago (' + Lib.formatTimeDiff(diff) +
    ')';
  chatClient.doSay(line, msg.channelName);
};

module.exports = exports = Bust;
