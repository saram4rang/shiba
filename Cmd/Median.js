'use strict';

const debug         = require('debug')('shiba:cmd:median');
const Pg           =  require('../Pg');

module.exports = exports = Median;

function Median() {
}

Median.prototype.init = function*() {
};

Median.prototype.handle = function*(client, msg, input) {

  debug('Handling median for "%s" games', input);

  if (!/[0-9]+/.test(input)) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  let numGames = parseInt(input);
  let result   = yield* Pg.getGameCrashMedian(numGames);
  let response = 'Median over last ' +
        result.count + ' games: ' + result.median/100 + 'x';

  client.doSay(response);
};
