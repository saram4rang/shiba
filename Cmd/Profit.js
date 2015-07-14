'use strict';

const debug        = require('debug')('shiba:cmd:profit');
const ProfitParser = require('./ProfitParser').parser;
const Lib          = require('../Lib');
const Pg           = require('../Pg');

function Profit() {
}

Profit.prototype.handle = function*(client, msg, rawInput) {

  debug('Handling profit: %s', JSON.stringify(rawInput));

  let input;
  try {
    input = ProfitParser.parse(rawInput.replace(/^\s+|\s+$/g,''));
  } catch(err) {
    client.doSay('wow. very usage failure. such retry');
    throw err;
  }

  let username = input.user ? input.user : msg.username;
  let result;
  if (input.time) {
    result = yield* Pg.getTimeProfit(username, input.time);
  } else {
    result = yield* Pg.getGamesProfit(username, input.games);
  }

  let response = (result/100).toFixed(2) + ' bits';
  client.doSay(response);
};

module.exports = exports = Profit;
