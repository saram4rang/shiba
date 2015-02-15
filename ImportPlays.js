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
  fs.readFile(file, 'utf8', function (err, data) {
    if (err) return cb(err);

    try {
      var info = JSON.parse(data);
    } catch(err) {
      return cb(err);
    }

    Pg.putPlays(info, function (err) {
      if (err) {
        console.error('Importing play info for #' + info.game_id, 'failed');
      } else {
        console.log('Imported play info for #' + info.game_id);
      }
      cb(err);
    });
  });
}
