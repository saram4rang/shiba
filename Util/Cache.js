'use strict';

const co         = require('co');
const AsyncCache = require('async-cache');

function Cache(opts) {
  const self = this;
  self.gen  = opts.load;
  self.opts = opts;

  // Create an opts object for async-cache with a callback-based load function.
  let acopts = Object.assign({}, opts, {
    load: (key, cb) => {
      co(self.gen(key)).then(res => cb(null, res), cb);
    }
  });

  self.cache = new AsyncCache(acopts);
}

Cache.prototype.get = function*(key) {
  const cache = this.cache;
  return yield function(cb) {
    cache.get(key, cb);
  };
};

module.exports = Cache;
