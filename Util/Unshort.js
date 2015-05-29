'use strict';

const parallel = require('co-parallel');
const request  = require('co-request');
const debug    = require('debug')('shiba:unshort');
const Cache    = require('./Cache');

const headers =
  {
    'Accept':'text/html,application/xhtml+xml',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en',
    'Cache-Control':'no-cache',
    'Pragma':'no-cache',
    'User-Agent':'Mozilla/5.0'
  };

const unshortCache = new Cache({
  max: 100,                    // Max 100 elements
  maxAge: 1000 * 60 * 60 * 10, // Max 10 hours
  load:
    function*(url) {
      debug("Loading '%s'", url);
      let opt = {url:url, headers:headers};
      let res = yield request(opt);

      // Return the URL after following all redirects.
      return res.request.href;
    }
});

function* unshort(url) {
  try {
    let res = yield* unshortCache.get(url);
    debug('Unshortened "%s" -> "%s"', url, res);
    return res;
  } catch(err) {
    console.error("[ERROR] Unshort: " + err);
    console.error("Url was:", JSON.stringify(url));
    throw err;
  }
}

function* unshorts(urls) {
  return yield* parallel(urls.map(unshort));
}

module.exports.unshort  = unshort;
module.exports.unshorts = unshorts;
