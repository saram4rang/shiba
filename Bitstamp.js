
var https = require('https');

var fetchTime = null;
var info      =
  { "high":      "333.99",
    "last":      "327.27",
    "timestamp": "1415030401",
    "bid":       "326.55",
    "vwap":      "328.65",
    "volume":    "9536.30242027",
    "low":       "322.00",
    "ask":       "327.19"
  };

var options =
  { hostname: 'www.bitstamp.net',
    port:     443,
    path:     '/api/ticker/',
    method:   'GET'
  };

exports.getInfo = function(cb) {
  var twoMinutes = 2 * 60 * 1000;
  if (fetchTime && fetchTime + twoMinutes < Date.now())
    return cb(null, info);

  var req = https.request(options, function(res) {
    res.on('data', function (data) {
      info = JSON.parse(data);
      fetchTime = Date.now();
      cb(null, info);
    });
  });
  req.end();
  req.on('error', function(e) {
    console.error('Error getting Bitstamp ticker:' + e);
    cb(e);
  });
};

exports.getAveragePrice = function (cb) {
  exports.getInfo(function(err, info) {
    if (err) return cb(err);

    var ask = parseInt(info.ask.replace(/\./g, ''));
    var bid = parseInt(info.bid.replace(/\./g, ''));
    var avg = (ask + bid) / 200;
    cb(err, avg);
  });
};
