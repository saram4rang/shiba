
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

exports.get = get;
exports.put = put;

function userKey(user) {
    return 'user/' + user.toLowerCase();
}
exports.getUsername = function(user, cb) {
    get(userKey(user), cb);
};
exports.putUsername = function(user, cb) {
    put(userKey(user), user, cb);
};

// Custom lick messages
function customLickKey(user) {
    return 'lick/' + user.toLowerCase();
}

exports.getCustomLickMessages = function(user, cb) {
    get(customLickKey(user), function(err, val) {
        if (err && err.notFound) {
            val = [];
            err = null;
        }
        return cb(err, val);
    });
};

exports.addCustomLickMessage = function(user, msg, cb) {
    exports.getCustomLickMessages(user, function(err, val) {
        if (err) {
            if (err.notFound) {
                val = [];
            } else {
                return cb(err, val);
            }
        }
        val.push(msg);
        put(customLickKey(user), val, cb);
    });
};

// Seen command
function seenKey(user) {
    return 'seen/' + user.toLowerCase();
}

exports.updateSeen = function(user, val, cb) {
    put(seenKey(user), val, cb);
};

exports.getSeen = function(user, cb) {
    get(seenKey(user), cb);
};
