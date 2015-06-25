'use strict';

const fx         = require('money');
const oxr        = require('open-exchange-rates');
const debug      = require('debug')('shiba:exchangerate');

const Config     = require('../Config');
const Cache      = require('./Cache');
const Bitstamp   = require('./Bitstamp');
const Poloniex   = require('./Poloniex');

// Oxr free plan only allows USD as the base currency.
oxr.base = 'USD';
oxr.set({ app_id: Config.OXR_APP_ID });

const ratesCache = new Cache({
  maxAge: 1000 * 60 * 60, // 1 hour
  load: function*() {
    debug('Downloading fiat exchange rates');
    yield oxr.latest.bind(oxr);
    return oxr.rates;
  }
});

function* getFiatRates() {
  return yield* ratesCache.get('');
}

function* getRates() {
  debug('Getting rates');

  let val    = yield [getFiatRates, Bitstamp.getAveragePrice];
  let rates  = val[0];
  let usdBtc = val[1];

  // Interestingly oxr provides us with a Bitcoin price from the
  // Coindesk Price Index. However, the oxr free plan only gives
  // us hourly updated rates. We use the realtime Bitstamp price
  // to be more up to date in this case.
  rates.BTC = 1   / usdBtc;
  rates.BIT = 1e6 / usdBtc;
  rates.SAT = 1e8 / usdBtc;

  function importpolo(sym) {
    let ticker = Poloniex.ticker["BTC_" + sym];
    let avg    = (ticker.lowestAsk + ticker.highestBid) / 2;
    rates[sym] = 1 / (usdBtc * avg);
  }

  importpolo('CLAM');
  importpolo('DOGE'); rates.KOINU = 1e8 * rates.DOGE;
  importpolo('LTC');
  importpolo('RDD');
  importpolo('NXT');

  return rates;
}
exports.getRates = getRates;

function* getSymbols() {
  let rates = yield* getRates();
  return Object.keys(rates);
}
exports.getSymbols = getSymbols;

function* convert(from, to, amount) {
  let rates = yield* getRates();
  fx.rates = rates;
  fx.base  = oxr.base;
  return fx(amount).convert({from:from, to:to});
}
exports.convert = convert;
