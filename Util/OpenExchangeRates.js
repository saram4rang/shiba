'use strict';

const debug   = require('debug')('shiba:oxr');
const request = require('co-request');

const API     = 'http://openexchangerates.org/api/';

function* getRates(opts, ep) {
  debug('Fetching openexchangerates');

  let appId = opts.appId;
  if (!appId)
    throw new Error('OpenExchangeRate app id needed');

  // Compose the final URL.
  let url = API + ep + '?app_id=' + appId;
  debug('oxr url: %s', url);

  // Fetch the data
  let req = yield request(url);
  let res = JSON.parse(req.body);
  if (res.error)
    throw res;

  res.timestamp *= 1000;

  return res;
}

exports.getLatest = function*(opts) {
  return yield* getRates(opts, 'latest.json');
};

exports.getHistorical = function*(opts, date) {
  return yield* getRates(opts, 'historical/' + date + '.json');
};
