'use strict';

const co     =  require('co');
const fs     =  require('fs');

const Client =  require('./Client');
const Lib    =  require('./Lib');
const Pg     =  require('./Pg');
const Config =  require('./Config');

function ensureDirSync(dir) {
  try { fs.mkdirSync(dir); }
  catch(e) { if (e.code != 'EEXIST') throw e; }
}
ensureDirSync('gamelogs');
ensureDirSync('gamelogs/unfinished');
ensureDirSync('chatlogs');

let client = new Client(Config);

function setupConsoleLog() {
  client.on('game_starting', function(info) {
    let line =
        "Starting " + info.game_id +
        " " + info.server_seed_hash.substring(0,8);
    process.stdout.write(line);
  });

  client.on('game_started', function(data) {
    process.stdout.write(".. ");
  });

  client.on('game_crash', function(data) {
    let gameInfo = client.getGameInfo();
    let crash    = Lib.formatFactor(data.game_crash);
    process.stdout.write(" @" + crash + "x " + gameInfo.verified + "\n");
  });
};

function setupGamelogWriter() {
  client.on('game_crash', function(data) {
    let gameInfo    = client.getGameInfo();
    let gameLogFile = 'gamelogs/' + gameInfo.game_id + '.json';
    fs.writeFile(gameLogFile, JSON.stringify(gameInfo, null, ' '));
  });

  client.on('disconnect', function(data) {
    if (client.game.state != 'ENDED') {
      let gameInfo = client.getGameInfo();
      let gameLogFile = 'gamelogs/unfinished/' + gameInfo.game_id + '.json';

      fs.writeFile(gameLogFile, JSON.stringify(gameInfo, null, ' '));
    }

    console.log('Client disconnected |', data, '|', typeof data);
  });
};

function setupChatlogWriter() {
  let chatDate    = null;
  let chatStream  = null;

  client.on('msg', function(msg) {
    // Write to the chatlog file. We create a file for each date.
    let now = new Date(Date.now());
    if (!chatDate || now.getUTCDay() != chatDate.getUTCDay()) {
      // End the old write stream for the previous date.
      if (chatStream) chatStream.end();

      // Create new write stream for the current date.
      let chatFile =
          "chatlogs/" + now.getUTCFullYear() +
          ('0'+(now.getUTCMonth()+1)).slice(-2) +
          ('0'+now.getUTCDate()).slice(-2) + ".log";
      chatDate   = now;
      chatStream = fs.createWriteStream(chatFile, {flags:'a'});
    }
    chatStream.write(JSON.stringify(msg) + '\n');
  });
};

function setupGamelogDb() {
  client.on('game_crash', function(data, info) {
    co(function*() {
      try {
        yield Pg.putGame(info);
      } catch(err) {
        console.error('Failed to log game #' + info.game_id + '.\nError:', err);
      }
    });
  });
};

function setupChatlogDb() {
  client.on('msg', function(msg) {
    co(function*() {
      try {
        yield Pg.putMsg(msg);
      } catch(err) {
        console.error('Failed to log msg:', msg, '\nError:', err);
      }
    });
  });
};

setupChatlogWriter();
setupConsoleLog();
setupGamelogWriter();
setupChatlogDb();
setupGamelogDb();
