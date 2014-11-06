var async       =  require('async');
var fs          =  require('fs');
var Db          =  require('./Db');

var chatfiles = fs.readdirSync('chatlogs');
async.mapSeries(chatfiles, function(file, cbf) {
    console.log(file);
    var lines = fs.readFileSync('chatlogs/' + file, 'utf8').split('\n');
    async.mapSeries(lines, function(line, cbl) {
        if (line === '')
            return cbl(null, null);

        var msg = JSON.parse(line);
        if (msg.type == 'say') {
            Db.putUsername(msg.username);
            Db.updateSeen(msg.username, msg, cbl);
        } else if (msg.type == 'mute') {
            Db.putUsername(msg.moderator);
            Db.updateSeen(msg.moderator, msg, cbl);
        } else {
            cbl(null, null);
        }
    }, cbf);
});
