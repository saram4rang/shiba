'use strict';

const co           =  require('co');
const debug        =  require('debug')('shiba');
const debugblock   =  require('debug')('shiba:blocknotify');
const debugautomute = require('debug')('shiba:automute');

const profanity    =  require('./profanity');
const Blockchain   =  require('./Blockchain');
const Unshort      =  require('./Util/Unshort');

const Client       =  require('./Client');
const Crash        =  require('./Crash');
const Lib          =  require('./Lib');
const Config       =  require('./Config');
const Pg           =  require('./Pg');

const CmdConvert   =  require('./Cmd/Convert');

// Command syntax
const cmdReg = /^\s*!([a-zA-z]*)\s*(.*)$/i;

function Shiba() {

  let self = this;
  self.cmdConvert = new CmdConvert();

  co(function*(){
    // Last received block information.
    self.block = yield* Pg.getLatestBlock();
    // Awkward name for an array that holds names of users which
    // will be when a new block has been mined.
    self.blockNotifyUsers = yield* Pg.getBlockNotifications();

    // List of automute regexps
    self.automutes = yield* Pg.getAutomutes();

    // Connect to the site.
    self.client = new Client(Config);

    self.setupChatHook();
    // self.setupConsoleLog();
    // self.setupLossStreakComment();
    self.setupScamComment();
    self.setupBlockchain();
  }).catch(function(err) {
    // Abort immediately on startup.
    throw err;
  });
}

Shiba.prototype.setupChatHook = function() {
  let self = this;
  self.client.on('msg', function(msg) {
    if (msg.type !== 'say') return;
    co(function*(){ yield* self.onSay(msg); })
      .catch(err => console.error('[ERROR] onSay:', err.stack));
  });
};

Shiba.prototype.setupConsoleLog = function() {
  let self = this;
  self.client.on('game_starting', function(info) {
    let line =
        "Starting " + info.game_id +
        " " + info.server_seed_hash.substring(0,8);
    process.stdout.write(line);
  });

  self.client.on('game_started', function(data) {
    process.stdout.write(".. ");
  });

  self.client.on('game_crash', function(data) {
    let gameInfo = self.client.getGameInfo();
    let crash = Lib.formatFactor(data.game_crash);
    process.stdout.write(" @" + crash + "x " + gameInfo.verified + "\n");
  });
};

Shiba.prototype.setupLossStreakComment = function() {
  let self = this;
  self.client.on('game_crash', function(data) {
    let gameHistory = self.client.gameHistory;

    // Determine loss streak
    let streak = gameHistory.length > 3;
    let i;
    for (i = 0; i < Math.min(gameHistory.length - 1, 4); ++i)
      streak = streak && gameHistory[i].game_crash <= 130;

    // Don't repeat yourself in a streak
    streak = streak && (gameHistory.length < 4 ||
                        gameHistory[i + 1].game_crash > 130);

    if (streak) self.client.doSay("wow. such rape. very butthurt");
  });
};

Shiba.prototype.setupScamComment = function() {
  let self = this;
  self.client.on('game_crash', function(data) {
    let gameInfo = self.client.getGameInfo();
    console.assert(gameInfo.hasOwnProperty('verified'));
    if (gameInfo.verified !== 'ok') {
      self.client.doSay('wow. such scam. very hash failure.');
    }
  });
};

Shiba.prototype.setupBlockchain = function() {
  this.blockchain = new Blockchain();
  this.blockchain.on('block', this.onBlock.bind(this));
};

Shiba.prototype.onBlock = function(block) {
  let newBlock =
    { height: block.height,
      hash: block.hash,
      confirmation: new Date(block.time*1000),
      notification: new Date()
    };

  let self = this;
  co(function*(){
    yield* Pg.putBlock(newBlock);

    // Check if block is indeed new and only signal in this case.
    if (newBlock.height > self.block.height) {
      self.block = newBlock;

      if (self.blockNotifyUsers.length > 0) {
        let users = self.blockNotifyUsers.join(': ') + ': ';
        let line = users + 'Block #' + newBlock.height + ' mined.';
        self.client.doSay(line);
        self.blockNotifyUsers = [];
        yield* Pg.clearBlockNotifications();
      }
    }
  }).catch(err => console.error('[ERROR] onBlock:', err));
};

Shiba.prototype.checkAutomute = function*(msg) {

  // Match entire message against the regular expressions.
  if (this.automutes.find(r => msg.message.match(r))) {
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

  for (let i in urls) {
    let url = urls[i];
    debugautomute('Checking url: ' + url);

    // Run the regular expressions against the unshortened url.
    let r = this.automutes.find(r => url.match(r));
    if (r) {
      debugautomute('URL matched ' + r);
      this.client.doMute(msg.username, '72h');
      return true;
    }
  }

  return false;
};

Shiba.prototype.getChatMessages = function(username, after) {
  let messages = [];
  let chatHistory = this.client.chatHistory;
  for (let i = 0; i < chatHistory.length; ++i) {
    let then = new Date(chatHistory[i].time);
    if (then < after) break;

    if (chatHistory[i].type === 'say' &&
        chatHistory[i].username === username)
      messages.push(chatHistory[i]);
  }
  return messages;
};

Shiba.prototype.checkRate = function*(msg) {
  let rates = [{count: 4, seconds: 1, mute: '15m'},
               {count: 5, seconds: 5, mute: '15m'},
               {count: 8, seconds: 12, mute: '15m'}
              ];

  let self = this;
  let rate = rates.find(rate => {
    let after    = new Date(Date.now() - rate.seconds*1000);
    let messages = self.getChatMessages(msg.username, after);
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
  let messages = this.getChatMessages(msg.username, after);

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
    yield* this.onCmdBlock(msg, rest);
    break;
  case 'crash':
  case 'cras':
  case 'crsh':
  case 'cra':
  case 'cr':
    yield* this.onCmdCrash(msg, rest);
    break;
  case 'automute':
    yield* this.onCmdAutomute(msg, rest);
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
    console.log(data);
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
    yield* this.onCmdCrash(msg, '< 1.05');
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

  console.log(message);
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

Shiba.prototype.onCmdCrash = function*(msg, cmd) {

  let qry;
  try {
    qry = Crash.parser.parse(cmd);
  } catch(err) {
    this.client.doSay('wow. very usage failure. such retry');
    return;
  }

  debug('Crash parse result: ' + JSON.stringify(qry));

  let res;
  try {
    res = yield* Pg.getCrash(qry);
  } catch(err) {
    console.error('[ERROR] onCmdCrash', err.stack);
    this.client.doSay('wow. such database fail');
    return;
  }

  // Assume that we have never seen this crashpoint.
  if(res.length === 0) {
    this.client.doSay('wow. such absence. never seen ' + cmd);
    return;
  }

  res = res[0];
  let time = new Date(res.created);
  let diff = Date.now() - time;
  let info = this.client.getGameInfo();
  let line =
    'Seen ' + Lib.formatFactorShort(res.game_crash) +
    ' in #' +  res.id +
    '. ' + (info.game_id - res.id) +
    ' games ago (' + Lib.formatTimeDiff(diff) +
    ')';
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

Shiba.prototype.onCmdAutomute = function*(msg, rest) {
  if (msg.role !== 'admin' &&
      msg.role !== 'moderator') return;

  let regex;
  try {
    let match = rest.match(/^\/(.*)\/([gi]*)$/);
    regex = new RegExp(match[1], match[2]);
  } catch(err) {
    this.client.doSay('regex compile file: ' + err.message);
    return;
  }

  try {
    yield* Pg.addAutomute(msg.username, regex);
  } catch(err) {
    this.client.doSay('failed adding automute to database.');
    return;
  }

  this.client.doSay('wow. so cool. very obedient');
  this.automutes.push(regex);
};

let shiba = new Shiba();
