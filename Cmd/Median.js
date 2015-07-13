'use strict';

const debug = require('debug')('shiba:cmd:median');
const Pg    = require('../Pg');

function Median() {
}

function parse(input) {
  var nums = [];

  for (;;) {
    let match = input.match(/^([0-9]+)(k|m)?(,\s*|\s+)?(.*)?/i);
    if (!match)
      return nums;

    let numGames = parseInt(match[1]);
    switch(match[2] && match[2].toLowerCase()) {
    case 'm': numGames *= 1000;
    case 'k': numGames *= 1000;
    }
    numGames = Math.min(1e5, numGames);
    nums.push(numGames);

    input = match[4] || '';
  }
}

Median.prototype.handle = function*(client, msg, input) {

  debug('Handling median for "%s" games', input);

  let nums = parse(input);
  if (nums.length <= 0) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  let result   = yield (nums.map(num => Pg.getGameCrashMedian(num)));
  nums = nums.map(num => '' + num).join(', ');
  result = result.map(obj => '' + (obj.median/100) + 'x').join(', ');

  let response = 'Median over last ' +
        nums + ' games: ' + result;

  client.doSay(response);
};

module.exports = exports = Median;
