'use strict';

const Cache   = require('./Cache');
const request = require('co-request');
const debug   = require('debug')('shiba:bitstamp');

const BITSTAMP_TICKER = 'https://www.bitstamp.net/api/ticker/';

function* getTicker() {
  debug('Requesting price ticker');
  try {
    let req = yield request(BITSTAMP_TICKER);
    debug('Response %s', req.body);
    return JSON.parse(req.body);
  } catch(err) {
    console.error('Getting Bitstamp ticker failed');
    console.error(err.stack);
    throw err;
  }
}

const tickerCache = new Cache({
  maxAge: 1000 * 60 * 2,
  load: getTicker
});

exports.getInfo = function*() {
  return yield* tickerCache.get('');
};

exports.getAveragePrice = function*() {
  let ticker = yield* tickerCache.get('');

  let ask = Math.round(1e8*parseFloat(ticker.ask, 10));
  let bid = Math.round(1e8*parseFloat(ticker.bid, 10));
  let avg = (ask + bid) / 2e8;

  debug('Average price: ' + avg);
  return avg;
};
