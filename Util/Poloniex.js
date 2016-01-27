'use strict';

const autobahn = require('autobahn');
const _        = require('lodash');
const debug    = require('debug')('verbose:poloniex');
const Polo     = require('poloniex.js');

const ticker = {};
exports.ticker = ticker;

/* Pull API to get the initial ticker upon startup. */
(function() {
  const polo = new Polo();
  polo.getTicker(function(err, pairs) {
    if (err) {
      console.error('Error getting Poloniex price ticker', err);
      return;
    }

    debug('Importing initial ticker data');
    _.forEach(pairs, function(data, key) {
      ticker[key] = {
        last:          parseFloat(data.last),
        lowestAsk:     parseFloat(data.lowestAsk),
        highestBid:    parseFloat(data.highestBid),
        percentChange: parseFloat(data.percentChange),
        baseVolume:    parseFloat(data.baseVolume),
        quoteVolume:   parseFloat(data.quoteVolume),
        isFrozen:      data.isFrozen,
        high24hr:      parseFloat(data.high24hr),
        low24hr:       parseFloat(data.low24hr)
      };
    });
  });
})();

/* Push API to follow any updates. */
const connection = new autobahn.Connection({
  url: 'wss://api.poloniex.com',
  realm: 'realm1'
});

function tickerEvent(args) {
  debug('Ticker event: %s', args[0]);

  ticker[args[0]] = {
    last:          parseFloat(args[1]),
    lowestAsk:     parseFloat(args[2]),
    highestBid:    parseFloat(args[3]),
    percentChange: parseFloat(args[4]),
    baseVolume:    parseFloat(args[5]),
    quoteVolume:   parseFloat(args[6]),
    isFrozen:      args[7],
    high24hr:      parseFloat(args[8]),
    low24hr:       parseFloat(args[9])
  };
}

connection.onopen = function(session) {
  debug('Connection established.');
  session.subscribe('ticker', tickerEvent);
};

connection.onclose = function(reason, details) {
  debug('Connection closed: %s (%s)', reason, JSON.stringify(details));
};

connection.open();
