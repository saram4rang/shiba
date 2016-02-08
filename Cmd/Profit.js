'use strict';

const debug        = require('debug')('shiba:cmd:profit');
const ProfitParser = require('./ProfitParser').parser;
const Pg           = require('../Pg');

function Profit() {
}

Profit.prototype.handle = function*(client, msg, rawInput) {
  debug('Handling profit: %s', JSON.stringify(rawInput));

  let input;
  try {
    input = ProfitParser.parse(rawInput.replace(/^\s+|\s+$/g, ''));
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channelName);
    throw err;
  }

  try {
    let username = input.user ? input.user : msg.username;
    // TODO: Move this constant.
    let isOwner  = username.toLowerCase() === 'ryan';
    let result;
    if (isOwner && input.time)
      result = yield* Pg.getSiteProfitTime(input.time);
    else if (isOwner)
      result = yield* Pg.getSiteProfitGames(input.games);
    else if (input.time)
      result = yield* Pg.getProfitTime(username, input.time);
    else
      result = yield* Pg.getProfitGames(username, input.games);

    let response = (result / 100).toFixed(2) + ' bits';
    client.doSay(response, msg.channelName);
  } catch(err) {
    client.doSay('wow. such database fail', msg.channelName);
    console.error('ERROR:', err && err.stack || err);
    throw err;
  }
};

module.exports = exports = Profit;
