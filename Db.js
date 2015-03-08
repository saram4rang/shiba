
var levelup = require('levelup');
var debug   = require('debug')('shiba:db');

var dbOptions =
    { createIfMissing: true,
      compression: true,
      keyEncoding: 'json',
      valueEncoding: 'json'
    };
var db = levelup('shiba.db', dbOptions);

function get(key, cb) {
    db.get(key, function(err, value) {
        if (err)
          console.error("Getting '%s' failed: %s", key, JSON.stringify(err));
        cb(err, value);
    });
}

function put(key, val, cb) {
    db.put(key, val, function(err) {
        if (err) console.error ("Putting '%s' failed: %s", key, err);
        return cb && cb(err);
    });
}

function getWithDefault(key, def, cb) {
  db.get(key, function(err, value) {
    if (err) {
      console.error("Getting '%s' failed: %s", key, JSON.stringify(err));
      return cb(null, def);
    } else {
      cb(err, value);
    }});
}

exports.get = get;
exports.put = put;
exports.getWithDefault = getWithDefault;
