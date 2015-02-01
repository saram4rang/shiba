var AsyncCache = require('async-cache');
var https      = require('https');
var debug      = require('debug')('shiba:bitstamp');

var options =
  { hostname: 'www.bitstamp.net',
    port:     443,
    path:     '/api/ticker/',
    method:   'GET'
  };

function getTicker(cb) {
  debug('Requesting price ticker');
  var chunks = [];
  var req = https.request(options, function(res) {
    res.on('data', chunks.push.bind(chunks));
    res.on('end', function () {
      var data = chunks.join();
      debug('Received ticker data: ' + data);
      try {
        var ticker = JSON.parse(data);
        return cb(null, ticker);
      } catch(err) {
        return cb(err);
      }
    });
  });
  req.end();
  req.on('error', function(e) {
    console.error('Error getting Bitstamp ticker:' + e);
    cb(e);
  });
}

var tickerCache = new AsyncCache({
  maxAge: 1000 * 60 * 2,
  load: function (key, cb) { getTicker(cb) }
});

exports.getInfo = function(cb) {
  tickerCache.get('', cb);
};

exports.getAveragePrice = function (cb) {
  tickerCache.get('', function(err, ticker) {
    if (err) return cb(err);

    var ask = parseInt(ticker.ask.replace(/\./g, ''));
    var bid = parseInt(ticker.bid.replace(/\./g, ''));
    var avg = (ask + bid) / 200;

    debug('Average price: ' + avg);
    cb(err, avg);
  });
};
