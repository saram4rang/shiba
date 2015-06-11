'use strict';

const debug = require('debug')('shiba:cmd:median');
const Pg    = require('../Pg');

function Median() {
}

Median.prototype.handle = function*(client, msg, input) {

  debug('Handling median for "%s" games', input);

  let match = input.match(/^([0-9]+)(k|m)?$/i);
  if (!match) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  let numGames = parseInt(match[1]);
  switch(match[2] && match[2].toLowerCase()) {
  case 'm': numGames *= 1000;
  case 'k': numGames *= 1000;
  }
  numGames = Math.min(1e5, numGames);

  let result   = yield* Pg.getGameCrashMedian(numGames);
  let response = 'Median over last ' +
        result.count + ' games: ' + result.median/100 + 'x';

  client.doSay(response);
};

module.exports = exports = Median;
