var async = require('async');
var fs    = require('fs');
var pg    = require('pg');
var Pg    = require('./Pg');

var files = process.argv.slice(2);

async.eachSeries(files, processFile, function (err) {
  if (err) console.error('Error:', err);
  pg.end();
});

function processFile(file, cb) {
  console.log('Processing', file);
  fs.readFile(file, 'utf8', function (err, data) {
    if (err) return cb(err);

    var lines = data.split('\n');
    async.eachLimit(lines, 10, function (line, cb) {
      if (line === "") return cb(null);

      try {
        var msg = JSON.parse(line);
      } catch (e) {
        return cb(e);
      }

      Pg.putMsg(msg, function(err) {
        if (err) {
          console.error('Importing msg:', msg, 'failed.');
        }
        cb(err);
      });
    }, cb);
  });
}
