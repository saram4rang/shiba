var autobahn = require('autobahn');
var debug    = require('debug')('shiba:poloniex');

var ticker = {};
exports.ticker = ticker;

/* Pull API to get the initial ticker upon startup. */
(function() {
  var Polo     = require('poloniex.js');
  var polo     = new Polo();
  polo.getTicker(function (err, data) {
    if (err)
      return console.error('Error getting Poloniex price ticker',
                           err);

    debug('Importing initial ticker data');
    for (var pair in data) {
      ticker[pair] =
        { last:          parseFloat(data[pair].last),
          lowestAsk:     parseFloat(data[pair].lowestAsk),
          highestBid:    parseFloat(data[pair].highestBid),
          percentChange: parseFloat(data[pair].percentChange),
          baseVolume:    parseFloat(data[pair].baseVolume),
          quoteVolume:   parseFloat(data[pair].quoteVolume),
          isFrozen:      data[pair].isFrozen,
          high24hr:      parseFloat(data[pair].high24hr),
          low24hr:       parseFloat(data[pair].low24hr)
        };
    }
  });
})();

/* Push API to follow any updates. */
var connection = new autobahn.Connection({
  url: "wss://api.poloniex.com",
  realm: "realm1"
});

function tickerEvent (args, kwargs) {
  debug('Ticker event: %s', args[0]);

  ticker[args[0]] =
    { last:          parseFloat(args[1]),
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

connection.onopen = function (session) {
  debug('Connection established.');
  session.subscribe('ticker', tickerEvent);
}

connection.onclose = function (reason, details) {
  debug('Connection closed: %s (%s)', reason, JSON.stringify(details));
}

connection.open();
