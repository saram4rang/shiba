var AsyncCache = require('async-cache');
var async      = require('async');
var fx         = require('money');
var oxr        = require('open-exchange-rates');
var debug      = require('debug')('shiba:exchangerate');

var Bitstamp   = require('./Bitstamp');
var Config     =  require('./Config')();

// Oxr free plan only allows USD as the base currency.
oxr.base = 'USD';
oxr.set({ app_id: Config.oxr_app_id });

var ratesCache = new AsyncCache({
  maxAge: 1000 * 60 * 60, // 1 hour
  load: function (key, cb) {
    debug('Downloading fiat exchange rates');
    oxr.latest(function(err) {
      if (err)
        return cb(err);
      else
        return cb(null, oxr.rates);
    });
  }
});

function getFiatRates(cb) {
  ratesCache.get('', cb);
}

exports.getRates = function(cb) {
  async.parallel(
    [ getFiatRates,
      Bitstamp.getAveragePrice
    ],
    function (err, val) {
      if (err) return cb(err);

      var rates  = val[0];
      var btcusd = val[1];
      // Interestingly oxr provides us with a Bitcoin price from the
      // Coindesk Price Index. However, the oxr free plan only gives
      // us hourly updated rates. We use the realtime Bitstamp price
      // to be more up to date in this case.
      rates.BTC = 1   / btcusd;
      rates.BIT = 1e6 / btcusd;
      rates.SAT = 1e8 / btcusd;

      return cb(null, rates);
    });
}

exports.getSymbols = function(db) {
  this.getRates(function(err, rates) {
    if (err) return cb(err);
    return cb(null, Object.keys(rates));
  });
};

exports.convert = function(from, to, amount, cb) {
  this.getRates(function(err, rates) {
    if (err) return cb(err);
    fx.rates = rates;
    fx.base  = oxr.base;
    return cb(null, fx(amount).convert({from:from, to:to}));
  });
};
