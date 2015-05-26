var AsyncCache = require('async-cache');
var async      = require('async');
var debug      = require('debug')('shiba:unshort');
var request    = require('request');

module.exports.unshort = unshort;
module.exports.unshorts = unshorts;

var headers =
  {
    'Accept':'text/html,application/xhtml+xml',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en',
    'Cache-Control':'no-cache',
    'Pragma':'no-cache',
    'User-Agent':'Mozilla/5.0'
  };

var unshortCache = new AsyncCache({
  max: 100,                    // Max 100 elements
  maxAge: 1000 * 60 * 60 * 10, // Max 10 hours
  load:
    function unshort(url, cb) {
      var opt = {url:url, headers:headers};
      var req = request.get(opt, function(err,res,body) {
        if (err) return cb(err);

        // Return the URL after following all redirects.
        cb(null, req.href);
      });
    }
});

function unshort(url, cb) {
  unshortCache.get(url, function(err,res) {
    if (err) {
      console.error("Got error while unshortening: '" + err + "'");
      console.error("Url was:", JSON.stringify(url));
      return cb(err);
    }

    debug('Unshortened "%s" -> "%s"', url, res);
    return cb(null, res);
  });
}

function unshorts(urls, cb) {
  async.map(urls, unshort, cb);
}
