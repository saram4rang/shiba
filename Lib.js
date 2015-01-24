var crypto      =  require('crypto');

module.exports =
  { sha256:
      function(data) {
        var hash = crypto.createHash('sha256');
        hash.update(data);
        return hash.digest('hex');
      },
    formatTimeDiff:
      function(diff) {
        diff = Math.floor(diff / 1000);

        var s  = diff % 60; diff = Math.floor(diff/60);
        var m  = diff % 60; diff = Math.floor(diff/60);
        var h  = diff % 24; diff = Math.floor(diff/24);
        var d  = diff;

        var words = [];
        if (d > 0) words.push('' + d + 'd');
        if (h > 0) words.push('' + h + 'h');
        if (m > 0) words.push('' + m + 'm');
        if (s > 0) words.push('' + s + 's');
        return words.join(' ');
      },
    formatFactor:
      function(f) {
        return (f/100).toFixed(2);
      },
    duration:
      function(cp) {
        return Math.ceil(this.inverseGrowth(cp + 1));
      },
    growthFunc:
      function(ms) {
        var r = 0.00006;
        return Math.floor(100 * Math.pow(Math.E, r * ms));
      },
    inverseGrowth:
      function(result) {
        var c = 16666.66666667;
        return c * Math.log(0.01 * result);
      },
    divisible:
      function(hash, mod) {
        /* Reduce the hash digit by digit to stay in the signed 32-bit integer range. */
        var val = hash.split('').reduce(function(r,d) {
          return ((r << 4) + parseInt(d,16)) % mod ; }, 0);
        return val === 0;
      },
    clientSeed:
      '000000000000000007a9a31ff7f07463d91af6b5454241d5faf282e5e0fe1b3a',
    crashPoint:
      function(serverSeed) {
        console.assert(typeof serverSeed === 'string');
        var hash =
          crypto
            .createHmac('sha256', serverSeed)
            .update(this.clientSeed)
            .digest('hex');

        // In 1 of 101 games the game crashes instantly.
        if (this.divisible(hash, 101))
          return 0;

        // Use the most significant 52-bit from the hash to calculate the crash point
        var h = parseInt(hash.slice(0,52/4),16);
        var e = Math.pow(2,52);

        return Math.floor((100 * e - h) / (e - h));
      }
  };
