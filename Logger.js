'use strict';

const co     =  require('co');
const fs     =  require('fs');

const Client =  require('./Client');
const Lib    =  require('./Lib');
const Pg     =  require('./Pg');
const Config =  require('./Config');

const mkChatStore = require('./Store/Chat');

function ensureDirSync(dir) {
  try { fs.mkdirSync(dir); }
  catch(e) { if (e.code !== 'EEXIST') throw e; }
}
ensureDirSync('gamelogs');
ensureDirSync('gamelogs/unfinished');
ensureDirSync('chatlogs');

co(function*(){

  let chatStore = yield* mkChatStore(true);

  // Connect to the site
  let client = new Client(Config);

  client.on('join', co.wrap(function*(data) {
      yield* chatStore.mergeMessages(data.chat);
    }));
  client.on('msg', co.wrap(chatStore.addMessage.bind(chatStore)));

  // Setup chatlog file writer
  let chatDate    = null;
  let chatStream  = null;

  chatStore.on('msg', function(msg) {
    // Write to the chatlog file. We create a file for each date.
    let now = new Date(Date.now());

    if (!chatDate || now.getUTCDay() !== chatDate.getUTCDay()) {
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

  client.on('game_crash', function(data, info) {
    co(function*() {
      try {
        yield* Pg.putGame(info);
      } catch(err) {
        console.error('Failed to log game #' + info.game_id + '.\nError:', err);
      }
    });
  });
});
