'use strict';

const debug        = require('debug')('shiba:cmd:streak');
const StreakParser = require('./StreakParser').parser;
const Lib          = require('../Lib');
const Pg           = require('../Pg');

const MAX_NUM_GAMES = 8;

function Streak() {
}

Streak.prototype.handle = function*(client, msg, input) {
  debug('Handling streak: %s', JSON.stringify(input));

  let streak;
  try {
    streak = StreakParser.parse(input.replace(/^\s+|\s+$/g, ''));
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channelName);
    throw err;
  }

  let result;
  try {
    result = streak.count ?
      yield* Pg.getLastStreak(streak.count, streak.op, streak.bound) :
      yield* Pg.getMaxStreak(streak.op, streak.bound);
  } catch(err) {
    client.doSay('wow. such database fail', msg.channelName);
    throw err;
  }

  if (result.length === 0) {
    client.doSay('never seen such streak', msg.channelName);
    return;
  }

  let numGames = result.length;
  let begin = result[0].game_id;
  let end = result[numGames - 1].game_id;
  let crashes = result
                  .slice(0, MAX_NUM_GAMES)
                  .map(game => Lib.formatFactor(game.game_crash) + 'x')
                  .join(', ');
  let response =
    'Seen ' + numGames + ' streak in games #' +
    begin + '-#' + end + ': ' + crashes;

  if (numGames > MAX_NUM_GAMES)
    response += ', ...';

  client.doSay(response, msg.channelName);
};

module.exports = exports = Streak;
