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
      }
  };
