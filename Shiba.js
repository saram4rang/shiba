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
    self.block = yield Pg.getLatestBlock();
    // Awkward name for an array that holds names of users which
    // will be when a new block has been mined.
    self.blockNotifyUsers = yield Pg.getBlockNotifications();

    // List of automute regexps
    self.automutes = yield Pg.getAutomutes();

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
  var self = this;
  self.client.on('msg', function(msg) {
    if (msg.type !== 'say') return;
    co(function*(){ yield self.onSay(msg); });
  });
};

Shiba.prototype.setupConsoleLog = function() {
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

Shiba.prototype.setupLossStreakComment = function() {
  var self = this;
  self.client.on('game_crash', function(data) {
    var gameHistory = self.client.gameHistory;

    // Determine loss streak
    var streak = gameHistory.length > 3;
    for (var i = 0; i < Math.min(gameHistory.length - 1, 4); ++i)
      streak = streak && gameHistory[i].game_crash <= 130;

    // Don't repeat yourself in a streak
    streak = streak && (gameHistory.length < 4 ||
                        gameHistory[i + 1].game_crash > 130);

    if (streak) self.client.doSay("wow. such rape. very butthurt");
  });
};

Shiba.prototype.setupScamComment = function() {
  var self = this;
  self.client.on('game_crash', function(data) {
    var gameInfo = self.client.getGameInfo();
    console.assert(gameInfo.hasOwnProperty('verified'));
    if (gameInfo.verified != 'ok') {
      self.client.doSay('wow. such scam. very hash failure.');
    }
  });
};

Shiba.prototype.setupBlockchain = function() {
  this.blockchain = new Blockchain();
  this.blockchain.on('block', this.onBlock.bind(this));
};

Shiba.prototype.onBlock = function(block) {
  var newBlock =
    { height: block.height,
      hash: block.hash,
      confirmation: new Date(block.time*1000),
      notification: new Date()
    };

  co(function*(){
    try {
      yield Pg.putBlock(newBlock);
    } catch(err) {
      console.error('Error putting block:', err);
    }
  });

  // Check if block is indeed new and only signal in this case.
  if (newBlock.height > this.block.height) {
    this.block = newBlock;

    if (this.blockNotifyUsers.length > 0) {
      var users = this.blockNotifyUsers.join(': ') + ': ';
      var line = users + 'Block #' + newBlock.height + ' mined.';
      this.client.doSay(line);
      this.blockNotifyUsers = [];
      Pg.clearBlockNotifications(function(err) {});
    }
  }
};

Shiba.prototype.getChatMessages = function(username, after) {
  var messages = [];
  var chatHistory = this.client.chatHistory;
  for (var i = 0; i < chatHistory.length; ++i) {
    var then = new Date(chatHistory[i].time);
    if (then < after) break;

    if (chatHistory[i].type === 'say' &&
        chatHistory[i].username === username)
      messages.push(chatHistory[i]);
  }
  return messages;
};

Shiba.prototype.onSay = function*(msg) {
  if (msg.username === this.client.username) return null;

  // Match entire message against the regular expressions.
  for (let r = 0; r < this.automutes.length; ++r)
    if (msg.message.match(this.automutes[r]))
      return this.client.doMute(msg.username, '36h');

  // Extract a list of URLs.
  // TODO: The regular expression could be made more intelligent.
  let urls  = msg.message.match(/https?:\/\/[^\s]+/ig) || [];
  let urls2 = msg.message.match(/(\s|^)(bit.ly|vk.cc|goo.gl)\/[^\s]+/ig) || [];
  urls2     = urls2.map(x => x.replace(/^\s*/,'http:\/\/'));
  urls      = urls.concat(urls2);

  if (urls.length > 0)
    debugautomute('Found urls:' + JSON.stringify(urls));

  // Unshorten extracted URLs.
  urls2 = yield Unshort.unshorts(urls);
  debugautomute('Unshort finished: ' + JSON.stringify(urls2));

  urls  = urls.concat(urls2 || []);
  debugautomute('Url list: ' + JSON.stringify(urls));

  for (let i in urls) {
    let url    = urls[i];
    if (typeof url !== 'string') continue;
    debugautomute('Checking url: ' + url);

    // Run the regular expressions against the unshortened url.
    for (let r = 0; r < this.automutes.length; ++r)
      if (url.match(this.automutes[r])) {
        debugautomute('URL matched ' + self.automutes[r]);
        return this.client.doMute(msg.username, '72h');
      }
  }

  let after, messages;
  // Rate limiter < 4 messages in 1s
  after    = new Date(Date.now() - 1000);
  messages = this.getChatMessages(msg.username, after);
  if (messages.length >= 4) return self.client.doMute(msg.username, '15m');

  // Rate limiter < 5 messages in 5s
  after    = new Date(Date.now() - 5000);
  messages = self.getChatMessages(msg.username, after);
  if (messages.length >= 5) return self.client.doMute(msg.username, '15m');

  // Rate limiter < 8 messages in 12s
  after    = new Date(Date.now() - 12000);
  messages = self.getChatMessages(msg.username, after);
  if (messages.length >= 8) return self.client.doMute(msg.username, '15m');

  // Everything checked out fine so far. Continue with the command
  // processing phase.
  let cmdMatch = msg.message.match(cmdReg);
  if (cmdMatch) self.onCmd(msg, cmdMatch[1], cmdMatch[2]);
};

Shiba.prototype.onCmd = function(msg, cmd, rest) {
  // Cmd rate limiter
  var after    = new Date(Date.now() - 10000);
  var messages = this.getChatMessages(msg.username, after);
  var rate = 0;

  for (var i = 0; i < messages.length; ++i)
    if (messages[i].message.match(cmdReg)) ++rate;

  if (rate >= 5)
    return this.client.doMute(msg.username, '5m');
  else if (rate >= 4)
    return this.client.doSay('bites ' + msg.username);

  switch(cmd.toLowerCase()) {
  case 'custom': this.onCmdCustom(msg, rest); break;
  case 'lick': this.onCmdLick(msg, rest); break;
  case 'seen': this.onCmdSeen(msg, rest); break;
  case 'faq':
  case 'help':
      this.onCmdHelp(msg, rest);
      break;
  case 'convert':
  case 'conver':
  case 'conv':
  case 'cv':
  case 'c':
      this.onCmdConvert(msg, rest);
      break;
  case 'block': this.onCmdBlock(msg, rest); break;
  case 'crash': this.onCmdCrash(msg, rest); break;
  case 'automute': this.onCmdAutomute(msg, rest); break;
  }
};

Shiba.prototype.onCmdHelp = function(msg, rest) {
  this.client.doSay(
      'very explanation. much insight: ' +
      'https://github.com/moneypot/shiba/wiki/');
};

Shiba.prototype.onCmdCustom = function(msg, rest) {
  var self = this;
  if (msg.role != 'admin' &&
      msg.role != 'moderator') return;

  var customReg   = /^([a-z0-9_\-]+)\s+(.*)$/i;
  var customMatch = rest.match(customReg);

  if (!customMatch) {
    self.client.doSay('wow. very usage failure. such retry');
    self.client.doSay('so example, very cool: !custom Ryan very dog lover');
    return;
  }

  var customUser  = customMatch[1];
  var customMsg   = customMatch[2];
  Pg.putLick(customUser, customMsg, msg.username, function (err) {
    if (err) {
      console.log('onCmdCustom:', err);
      self.client.doSay('wow. such database fail');
    } else {
      self.client.doSay('wow. so cool. very obedient');
    }
  });
};

Shiba.prototype.onCmdLick = function(msg, user) {
  var self = this;
  user = user.toLowerCase();
  user = user.replace(/^\s+|\s+$/g,'');

  // We're cultivated and don't lick ourselves.
  if (user === self.client.username.toLowerCase()) return;

  if (profanity[user]) {
    self.client.doSay('so trollol. very annoying. such mute');
    self.client.doMute(msg.username, '5m');
    return;
  }

  Pg.getLick(user, function(err, data) {
    if (err) {
      if (err === 'USER_DOES_NOT_EXIST')
        self.client.doSay('very stranger. never seen');
      return;
    }

    var username = data.username;
    var customs = data.licks;
    customs.push('licks ' + username);
    var r = Math.random() * (customs.length - 0.8);
    var m = customs[Math.floor(r)];
    self.client.doSay(m);
  });
};

Shiba.prototype.onCmdSeen = function(msg, user) {
  var self = this;
  user = user.toLowerCase().replace(/^\s+|\s+$/g,'');

  // Make sure the username is valid
  if (Lib.isInvalidUsername(user)) {
    self.client.doSay('such name. very invalid');
    return;
  }

  // In case a user asks for himself.
  if (user === msg.username.toLowerCase()) {
    self.client.doSay('go find a mirror @' + msg.username);
    return;
  }

  // Special treatment of block.
  if (user === 'block') return this.onCmdBlock(msg);

  // Avoid this.
  if (user === self.client.username.toLowerCase()) return;

  if (profanity[user]) {
    self.client.doSay('so trollol. very annoying. such mute');
    self.client.doMute(msg.username, '5m');
    return;
  }

  Pg.getLastSeen(user, function (err, message) {
    if (err) {
      if (err === 'USER_DOES_NOT_EXIST')
        self.client.doSay('very stranger. never seen');
      return;
    }

    if (!message.time) {
      // User exists but hasn't said a word.
      return self.client.doSay('very silent. never spoken');
    }

    var diff = Date.now() - message.time;
    var line;
    if (diff < 1000) {
      line = 'Seen ' + message.username + ' just now.';
    } else {
      line = 'Seen ' + message.username + ' ';
      line += Lib.formatTimeDiff(diff);
      line += ' ago.';
    }

    self.client.doSay(line);
  });
};

Shiba.prototype.onCmdCrash = function(msg, cmd) {
  var self = this;

  try {
    var qry = Crash.parser.parse(cmd);
    debug('Crash parse result: ' + JSON.stringify(qry));

    Pg.getCrash(qry, function(err, data) {
      if (err || data.length == 0) {
        // Assume that we have never seen this crashpoint.
        return self.client.doSay('wow. such absence. never seen ' + cmd);
      } else {
        data = data[0];
        var time = new Date(data.created);
        var diff = Date.now() - time;
        var info = self.client.getGameInfo();
        var line =
          'Seen ' + Lib.formatFactorShort(data.game_crash) +
          ' in #' +  data.id +
          '. ' + (info.game_id - data.id) +
          ' games ago (' + Lib.formatTimeDiff(diff) +
          ')';
        self.client.doSay(line);
      }
    });
  } catch(e) {
    console.log('Error', e);
    return self.client.doSay('wow. very usage failure. such retry');
  }
};

Shiba.prototype.onCmdConvert = function(msg, conv) {
  let client     = this.client;
  let cmdConvert = this.cmdConvert;
  co(function*(){ yield cmdConvert.handle(client, msg, conv); });
};

Shiba.prototype.onCmdBlock = function(msg) {
  var time  = this.block.notification;
  var diff  = Date.now() - time;

  var line = 'Seen block #' + this.block.height;
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
    Pg.putBlockNotification(msg.username, function(err) {});
  } else {
    debugblock("User '%s' is already on block notfy list", msg.username);
    line += ' ' + msg.username + ': Have patience!';
  }

  this.client.doSay(line);
};

Shiba.prototype.onCmdAutomute = function(msg, rest) {
  var self = this;
  if (msg.role != 'admin' &&
      msg.role != 'moderator') return;

  try {
    var match = rest.match(/^\/(.*)\/([gi]*)$/);
    var regex = new RegExp(match[1], match[2]);
  } catch(e) {
    return self.client.doSay('Regex compile file: ' + e.message);
  }

  Pg.addAutomute(msg.username, regex, function(err) {
    if (err) {
      self.client.doSay('failed adding automute to database.');
    } else {
      self.client.doSay('wow. so cool. very obedient');
      self.automutes.push(regex);
    }
  });
};

var shiba = new Shiba();
