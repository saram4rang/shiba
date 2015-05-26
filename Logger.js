var fs           =  require('fs');

var Client       =  require('./Client');
var Lib          =  require('./Lib');
var Pg           =  require('./Pg');
var Config       =  require('./Config');

function ensureDirSync(dir) {
  try { fs.mkdirSync(dir); }
  catch(e) { if (e.code != 'EEXIST') throw e; }
}
ensureDirSync('gamelogs');
ensureDirSync('gamelogs/unfinished');
ensureDirSync('chatlogs');

function Logger() {
  this.client = new Client(Config);
  this.setupChatlogWriter();
  this.setupConsoleLog();
  this.setupGamelogWriter();
  this.setupChatlogDb();
  this.setupGamelogDb();
}

Logger.prototype.setupConsoleLog = function() {
  var self = this;
  self.client.on('game_starting', function(info) {
    var line =
        "Starting " + info.game_id +
        " " + info.server_seed_hash.substring(0,8);
    process.stdout.write(line);
  });

  self.client.on('game_started', function(data) {
    process.stdout.write(".. ");
  });

  self.client.on('game_crash', function(data) {
    var gameInfo = self.client.getGameInfo();
    var crash = Lib.formatFactor(data.game_crash);
    process.stdout.write(" @" + crash + "x " + gameInfo.verified + "\n");
  });
};

Logger.prototype.setupGamelogWriter = function() {
  var self = this;
  self.client.on('game_crash', function(data) {
    var gameInfo = self.client.getGameInfo();
    var gameLogFile = 'gamelogs/' + gameInfo.game_id + '.json';
    fs.writeFile(gameLogFile, JSON.stringify(gameInfo, null, ' '));
  });

  self.client.on('disconnect', function(data) {
    if (self.client.game.state != 'ENDED') {
      var gameInfo = self.client.getGameInfo();
      var gameLogFile = 'gamelogs/unfinished/' + gameInfo.game_id + '.json';

      fs.writeFile(gameLogFile, JSON.stringify(gameInfo, null, ' '));
    }

    console.log('Client disconnected |', data, '|', typeof data);
  });
};

Logger.prototype.setupChatlogWriter = function() {
  var chatDate    = null;
  var chatStream  = null;

  this.client.on('msg', function(msg) {
    // Write to the chatlog file. We create a file for each date.
    var now = new Date(Date.now());
    if (!chatDate || now.getUTCDay() != chatDate.getUTCDay()) {
      // End the old write stream for the previous date.
      if (chatStream) chatStream.end();

      // Create new write stream for the current date.
      var chatFile =
          "chatlogs/" + now.getUTCFullYear() +
          ('0'+(now.getUTCMonth()+1)).slice(-2) +
          ('0'+now.getUTCDate()).slice(-2) + ".log";
      chatDate = now;
      chatStream = fs.createWriteStream(chatFile, {flags:'a'});
    }
    chatStream.write(JSON.stringify(msg) + '\n');
  });
};

Logger.prototype.setupGamelogDb = function() {
  this.client.on('game_crash', function(data, info) {
    Pg.putGame(info, function(err) {
      if (err) console.error('Failed to log game #' + info.game_id + '.\nError:', err);
    });
  });
};

Logger.prototype.setupChatlogDb = function() {
  this.client.on('msg', function(msg) {
    Pg.putMsg(msg, function(err) {
      if (err) console.error('Failed to log msg:', msg, '\nError:', err);
    });
  });
};

var logger = new Logger();
