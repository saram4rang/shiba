'use strict';

const co           =  require('co');
const debug        =  require('debug')('shiba');
const debugblock   =  require('debug')('shiba:blocknotify');
const debugautomute = require('debug')('shiba:automute');

const profanity    =  require('./profanity');
const Unshort      =  require('./Util/Unshort');

const Client       =  require('./Client');
const Lib          =  require('./Lib');
const Config       =  require('./Config');
const Pg           =  require('./Pg');

const CmdAutomute  =  require('./Cmd/Automute');
const CmdConvert   =  require('./Cmd/Convert');
const CmdBust      =  require('./Cmd/Bust');
const CmdMedian    =  require('./Cmd/Median');
const CmdStreak    =  require('./Cmd/Streak');

const mkCmdBlock     =  require('./Cmd/Block');
const mkAutomuteStore = require('./Store/Automute');
const mkChatStore     = require('./Store/Chat');
const mkGameStore     = require('./Store/Game');

// Command syntax
const cmdReg = /^\s*!([a-zA-z]*)\s*(.*)$/i;

function Shiba() {

  let self = this;

  co(function*(){

    // List of automute regexps
    self.automuteStore = yield* mkAutomuteStore();
    self.chatStore     = yield* mkChatStore(false);
    self.gameStore     = yield* mkGameStore(false);

    self.cmdAutomute = new CmdAutomute(self.automuteStore);
    self.cmdConvert  = new CmdConvert();
    self.cmdBlock    = yield mkCmdBlock();
    self.cmdBust     = new CmdBust();
    self.cmdMedian   = new CmdMedian();
    self.cmdStreak   = new CmdStreak();

    // Connect to the site.
    self.client = new Client(Config);

    // Setup the chat bindings.
    self.client.on('join', co.wrap(function*(data) {
      let games = data.table_history.sort((a,b) => a.game_id - b.game_id);
      yield [ self.chatStore.mergeMessages(data.chat),
              self.gameStore.mergeGames(games)
            ];
    }));
    self.client.on('msg', function(msg) {
      co(function*(){
        yield* self.chatStore.addMessage(msg);
        if (msg.type === 'say')
          yield* self.onSay(msg);
      }).catch(err => console.error('[ERROR] onMsg:', err.stack));
    });
    self.client.on('game_crash', co.wrap(function*(data, gameInfo) {
      yield* self.gameStore.addGame(gameInfo);
    }));

    self.cmdBlock.setClient(self.client);
    self.setupScamComment();
  }).catch(function(err) {
    // Abort immediately when an exception is thrown on startup.
    console.error(err.stack);
    throw err;
  });
}

Shiba.prototype.setupScamComment = function() {
  let self = this;
  self.client.on('game_crash', function(data) {
    let gameInfo = self.client.getGameInfo();
    console.assert(gameInfo.hasOwnProperty('verified'));

    if (gameInfo.verified !== 'ok')
      self.client.doSay('wow. such scam. very hash failure.');
  });
};

Shiba.prototype.checkAutomute = function*(msg) {

  // Match entire message against the regular expressions.
  let automutes = this.automuteStore.get();
  if (automutes.find(r => msg.message.match(r))) {
    this.client.doMute(msg.username, '36h');
    return true;
  }

  // Extract a list of URLs.
  // TODO: The regular expression could be made more intelligent.
  let urls  = msg.message.match(/https?:\/\/[^\s]+/ig) || [];
  let urls2 = msg.message.match(/(\s|^)(bit.ly|vk.cc|goo.gl)\/[^\s]+/ig) || [];
  urls2     = urls2.map(x => x.replace(/^\s*/,'http:\/\/'));
  urls      = urls.concat(urls2);

  // No URLs found.
  if (urls.length === 0) return false;

  // Unshorten extracted URLs.
  urls2 = yield* Unshort.unshorts(urls);
  urls  = urls.concat(urls2 || []);

  debugautomute('Url list: ' + JSON.stringify(urls));

  for (let url of urls) {
    debugautomute('Checking url: ' + url);

    // Run the regular expressions against the unshortened url.
    let r = automutes.find(r => url.match(r));
    if (r) {
      debugautomute('URL matched ' + r);
      this.client.doMute(msg.username, '72h');
      return true;
    }
  }

  return false;
};

Shiba.prototype.checkRate = function*(msg) {
  let rates = [{count: 4, seconds: 1, mute: '15m'},
               {count: 5, seconds: 5, mute: '15m'},
               {count: 8, seconds: 12, mute: '15m'}
              ];

  let self = this;
  let rate = rates.find(rate => {
    let after    = new Date(Date.now() - rate.seconds*1000);
    let messages = self.chatStore.getChatMessages(msg.username, after);
    return messages.length > rate.count;
  });

  if (rate) {
    this.client.doMute(msg.username, rate.mute);
    return true;
  }

  return false;
};

Shiba.prototype.onSay = function*(msg) {
  if (msg.username === this.client.username) return;

  if (yield* this.checkAutomute(msg)) return;
  if (yield* this.checkRate(msg)) return;

  // Everything checked out fine so far. Continue with the command
  // processing phase.
  let cmdMatch = msg.message.match(cmdReg);
  if (cmdMatch) yield* this.onCmd(msg, cmdMatch[1], cmdMatch[2]);
};

Shiba.prototype.checkCmdRate = function*(msg) {
  let after    = new Date(Date.now() - 10*1000);
  let messages = this.chatStore.getChatMessages(msg.username, after);

  let count = 0;
  messages.forEach(m => { if (m.message.match(cmdReg)) ++count; });

  if (count >= 5) {
    this.client.doMute(msg.username, '5m');
    return true;
  } else if (count >= 4) {
    this.client.doSay('bites ' + msg.username);
    return true;
  }

  return false;
};

Shiba.prototype.onCmd = function*(msg, cmd, rest) {
  // Cmd rate limiter
  if (yield* this.checkCmdRate(msg)) return;

  switch(cmd.toLowerCase()) {
  case 'custom':
    yield* this.onCmdCustom(msg, rest);
    break;
  case 'lick':
  case 'lck':
  case 'lic':
  case 'lik':
  case 'lk':
    yield* this.onCmdLick(msg, rest);
    break;
  case 'seen':
  case 'sen':
  case 'sn':
  case 's':
    yield* this.onCmdSeen(msg, rest);
    break;
  case 'faq':
  case 'help':
    yield* this.onCmdHelp(msg, rest);
    break;
  case 'convert':
  case 'conver':
  case 'conv':
  case 'cv':
  case 'c':
    yield* this.onCmdConvert(msg, rest);
    break;
  case 'block':
  case 'blck':
  case 'blk':
  case 'bl':
    yield* this.cmdBlock.handle(this.client, msg, rest);
    break;
  case 'crash':
  case 'cras':
  case 'crsh':
  case 'cra':
  case 'cr':
    this.client.doSay('@' + msg.username + ' use !bust instead');
  case 'bust':
  case 'bst':
  case 'bt':
    yield* this.cmdBust.handle(this.client, msg, rest);
    break;
  case 'automute':
    yield* this.cmdAutomute.handle(this.client, msg, rest);
    break;
  case 'median':
  case 'med':
    yield* this.cmdMedian.handle(this.client, msg, rest);
    break;
  case 'streak':
    yield* this.cmdStreak.handle(this.client, msg, rest);
    break;
  }
};

Shiba.prototype.onCmdHelp = function*(msg, rest) {
  this.client.doSay(
      'very explanation. much insight: ' +
      'https://github.com/moneypot/shiba/wiki/');
};

Shiba.prototype.onCmdCustom = function*(msg, rest) {
  if (msg.role !== 'admin' &&
      msg.role !== 'moderator') return;

  let customReg   = /^([a-z0-9_\-]+)\s+(.*)$/i;
  let customMatch = rest.match(customReg);

  if (!customMatch) {
    this.client.doSay('wow. very usage failure. such retry');
    this.client.doSay('so example, very cool: !custom Ryan very dog lover');
    return;
  }

  let customUser  = customMatch[1];
  let customMsg   = customMatch[2];

  try {
    yield* Pg.putLick(customUser, customMsg, msg.username);
    this.client.doSay('wow. so cool. very obedient');
  } catch(err) {
    console.error('[ERROR] onCmdCustom:', err.stack);
    this.client.doSay('wow. such database fail');
  }
};

Shiba.prototype.onCmdLick = function*(msg, user) {
  user = user.toLowerCase();
  user = user.replace(/^\s+|\s+$/g,'');

  // We're cultivated and don't lick ourselves.
  if (user === this.client.username.toLowerCase()) return;

  if (profanity[user]) {
    this.client.doSay('so trollol. very annoying. such mute');
    this.client.doMute(msg.username, '5m');
    return;
  }

  try {
    // Get licks stored in the DB.
    let data     = yield* Pg.getLick(user);
    let username = data.username;
    let customs  = data.licks;

    // Add standard lick to the end.
    customs.push('licks ' + username);

    // Randomly pick a lick message with lower probability of the
    // standard one.
    let r = Math.random() * (customs.length - 0.8);
    let m = customs[Math.floor(r)];
    this.client.doSay(m);
  } catch(err) {
    if (err === 'USER_DOES_NOT_EXIST')
      this.client.doSay('very stranger. never seen');
    else
      console.error('[ERROR] onCmdLick:', err);
  }
};

Shiba.prototype.onCmdSeen = function*(msg, user) {
  user = user.toLowerCase().replace(/^\s+|\s+$/g,'');

  // Make sure the username is valid
  if (Lib.isInvalidUsername(user)) {
    this.client.doSay('such name. very invalid');
    return;
  }

  // In case a user asks for himself.
  if (user === msg.username.toLowerCase()) {
    this.client.doSay('go find a mirror @' + msg.username);
    return;
  }

  // Special treatment of block.
  if (user === 'block') {
    yield* this.onCmdBlock(msg);
    return;
  }

  // Special treatment of rape.
  if (user === 'rape') {
    yield* this.cmdBust.handle(this.client, msg, '< 1.05');
    return;
  }

  // Somebody asks us when we've seen ourselves.
  if (user === this.client.username.toLowerCase()) {
    this.client.doSay('strange loops. much confusion.');
    return;
  }

  if (profanity[user]) {
    this.client.doSay('so trollol. very annoying. such mute');
    this.client.doMute(msg.username, '5m');
    return;
  }

  let message;
  try {
    message = yield* Pg.getLastSeen(user);
  } catch(err) {
    if (err === 'USER_DOES_NOT_EXIST')
      this.client.doSay('very stranger. never seen');
    else {
      console.error('[ERROR] onCmdSeen:', err.stack);
      this.client.doSay('wow. such database fail');
    }
    return;
  }

  if (!message.time) {
    // User exists but hasn't said a word.
    this.client.doSay('very silent. never spoken');
    return;
  }

  let diff = Date.now() - message.time;
  let line;
  if (diff < 1000) {
    line = 'Seen ' + message.username + ' just now.';
  } else {
    line = 'Seen ' + message.username + ' ';
    line += Lib.formatTimeDiff(diff);
    line += ' ago.';
  }
  this.client.doSay(line);
};

Shiba.prototype.onCmdConvert = function*(msg, conv) {
  yield* this.cmdConvert.handle(this.client, msg, conv);
};

Shiba.prototype.onCmdBlock = function*(msg) {
  let time  = this.block.notification;
  let diff  = Date.now() - time;

  let line = 'Seen block #' + this.block.height;
  if (diff < 1000) {
    line += ' just now.';
  } else {
    line += ' ';
    line += Lib.formatTimeDiff(diff);
    line += ' ago.';
  }

  // Add the user to the list of users being notified about a new block.
  if (this.blockNotifyUsers.indexOf(msg.username) < 0) {
    debugblock("Adding user '%s' to block notfy list", msg.username);
    this.blockNotifyUsers.push(msg.username);
    yield* Pg.putBlockNotification(msg.username);
  } else {
    debugblock("User '%s' is already on block notfy list", msg.username);
    line += ' ' + msg.username + ': Have patience!';
  }

  this.client.doSay(line);
};

let shiba = new Shiba();
