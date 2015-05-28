'use strict';

const co         = require('co');
const AsyncCache = require('async-cache');

function Cache(opts) {
  const self = this;
  self.gen  = opts.load;
  self.opts = opts;

  opts.load = function(key, cb) {
    co(self.gen(key))
      .then(function(res) { cb(null,res); },
            function(err) { cb(err); });
  };

  self.cache = new AsyncCache(opts);
}

Cache.prototype.get = function*(key) {
  const cache = this.cache;
  return yield function(cb) { cache.get(key,cb); };
};

module.exports = Cache;
