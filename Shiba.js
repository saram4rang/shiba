'use strict';

const _             =  require('lodash');
const co            =  require('co');
const fs            =  require('fs');
const debug         =  require('debug')('shiba');
const debugautomute =  require('debug')('shiba:automute');

const profanity    =  require('./profanity');
const Unshort      =  require('./Util/Unshort');

const Config       =  require('./Config');
const Client       =  require('./GameClient');
const WebClient    =  require('./WebClient');
const Lib          =  require('./Lib');
const Pg           =  require('./Pg');

const CmdAutomute  =  require('./Cmd/Automute');
const CmdConvert   =  require('./Cmd/Convert');
const CmdBust      =  require('./Cmd/Bust');
const CmdMedian    =  require('./Cmd/Median');
const CmdProb      =  require('./Cmd/Prob');
const CmdProfit    =  require('./Cmd/Profit');
const CmdSql       =  require('./Cmd/Sql');
const CmdStreak    =  require('./Cmd/Streak');
const CmdWagered   =  require('./Cmd/Wagered');

const mkCmdBlock     =  require('./Cmd/Block');
const mkAutomuteStore = require('./Store/Automute');
const mkChatStore     = require('./Store/Chat');
const mkGameStore     = require('./Store/Game');

// Make sure directories exist for the filesystem log
function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir);
  } catch(e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
ensureDirSync('chatlogs');

// Command syntax
const cmdReg = /^\s*!([a-zA-z]*)\s*(.*)$/i;

function Shiba() {
  let self = this;

  co(function*() {
    // List of automute regexps
    self.automuteStore = yield* mkAutomuteStore();
    self.chatStore     = yield* mkChatStore();
    self.gameStore     = yield* mkGameStore();

    self.cmdAutomute = new CmdAutomute(self.automuteStore);
    self.cmdConvert  = new CmdConvert();
    self.cmdBlock    = yield mkCmdBlock();
    self.cmdBust     = new CmdBust();
    self.cmdMedian   = new CmdMedian();
    self.cmdProb     = new CmdProb();
    self.cmdProfit   = new CmdProfit();
    self.cmdSql      = new CmdSql();
    self.cmdStreak   = new CmdStreak();
    self.cmdWagered  = new CmdWagered();

    // Connect to the game server.
    self.client = new Client(Config);

    // Connect to the web server.
    self.webClient = new WebClient(Config);

    // Setup the game bindings.
    self.client.on('join', co.wrap(function*(data) {
      yield* self.gameStore.fillMissing(data);
    }));
    self.client.on('game_crash', co.wrap(function*(data, gameInfo) {
      yield* self.gameStore.addGame(gameInfo);
    }));

    // Setup the chat bindings.
    self.webClient.on('join', function(data) {
      co(function*() {
        yield* self.chatStore.mergeMessages(data.history.reverse());
      }).catch(function(err) {
        console.error('Error importing history:', err, err.stack);
      });
    });
    self.webClient.on('msg', function(msg) {
      co(function*() {
        yield* self.chatStore.addMessage(msg);
      }).catch(err => console.error('[ERROR] onMsg:', err.stack));
    });
    // Setup a handler for new messages added to the store, so that unseen
    // messages during a restart are handled properly.
    self.chatStore.on('msg', co.wrap(function*(msg) {
      try {
        if (msg.type === 'say')
          yield* self.onSay(msg);
      } catch(err) {
        console.err('[Shiba.onMsg]', err && err.stack || err);
      }
    }));

    self.cmdBlock.setClient(self.webClient);

    self.setupScamComment();
    self.setupChatlogWriter();
  }).catch(function(err) {
    // Abort immediately when an exception is thrown on startup.
    console.error(err.stack);
    throw err;
  });
}

Shiba.prototype.setupScamComment = function() {
  let self = this;
  self.client.on('game_crash', function(data) { /* eslint no-unused-vars: 0 */
    let gameInfo = self.client.getGameInfo();
    console.assert(gameInfo.hasOwnProperty('verified'));

    if (gameInfo.verified !== 'ok')
      self.webClient.doSay('wow. such scam. very hash failure.', 'english');
  });
};

Shiba.prototype.setupChatlogWriter = function() {
  let chatDate    = null;
  let chatStream  = null;

  this.chatStore.on('msg', msg => {
    // Write to the chatlog file. We create a file for each date.
    let now = new Date(Date.now());

    if (!chatDate || now.getUTCDay() !== chatDate.getUTCDay()) {
      // End the old write stream for the previous date.
      if (chatStream) chatStream.end();

      // Create new write stream for the current date.
      let chatFile =
        'chatlogs/' + now.getUTCFullYear() +
        ('0' + (now.getUTCMonth() + 1)).slice(-2) +
        ('0' + now.getUTCDate()).slice(-2) + '.log';
      chatDate   = now;
      chatStream = fs.createWriteStream(chatFile, {flags: 'a'});
    }
    chatStream.write(JSON.stringify(msg) + '\n');
  });
};

Shiba.prototype.checkAutomute = function*(msg) {
  // Don't bother checking messages from the spam channel.
  if (msg.channelName === 'spam') return false;

  // Match entire message against the regular expressions.
  let automutes = this.automuteStore.get();
  if (automutes.find(r => msg.message.match(r))) {
    this.webClient.doMute(msg.username, '3h', msg.channelName);
    return true;
  }

  // Extract a list of URLs.
  // TODO: The regular expression could be made more intelligent.
  let urls  = msg.message.match(/https?:\/\/[^\s]+/ig) || [];
  let urls2 = msg.message.match(/(\s|^)(bit.ly|vk.cc|goo.gl)\/[^\s]+/ig) || [];
  urls2     = urls2.map(x => x.replace(/^\s*/, 'http:\/\/'));
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
    let automute = automutes.find(r => url.match(r));
    if (automute) {
      debugautomute('URL matched ' + automute);
      this.webClient.doMute(msg.username, '6h', msg.channelName);
      return true;
    }
  }

  return false;
};

Shiba.prototype.checkRate = function*(msg) {
  let rates = [
    {count: 12, seconds: 1, mute: '12h'},
    {count: 10, seconds: 1, mute: '9h'},
    {count: 8, seconds: 1, mute: '6h'},
    {count: 6, seconds: 1, mute: '30m'},
    {count: 4, seconds: 1, mute: '15m'},
    {count: 5, seconds: 5, mute: '15m'},
    {count: 8, seconds: 12, mute: '15m'}
  ];

  for (let rate of rates) {
    let after    = new Date(Date.now() - rate.seconds * 1000);
    let messages = this.chatStore.getChatMessages(msg.username, after);

    if (messages.length > rate.count) {
      this.webClient.doMute(msg.username, rate.mute, msg.channelName);
      return true;
    }
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
  if (cmdMatch) yield* this.onCmd(msg, cmdMatch[1], _.trim(cmdMatch[2]));
};

Shiba.prototype.checkCmdRate = function*(msg) {
  let after    = new Date(Date.now() - 10 * 1000);
  let messages = this.chatStore.getChatMessages(msg.username, after);

  let count = 0;
  messages.forEach(m => {
    if (m.message.match(cmdReg)) ++count;
  });

  if (count >= 5) {
    this.webClient.doMute(msg.username, '5m', msg.channelName);
    return true;
  } else if (count >= 4) {
    this.webClient.doSay('bites ' + msg.username, msg.channelName);
    return true;
  }

  return false;
};

// Map command names to list of aliases:
let cmdAliases = {
  custom:   [],
  lick:     ['lck', 'lic', 'lik', 'lk'],
  seen:     ['sen', 'sn', 's'],
  help:     ['faq'],
  convert:  ['conver', 'conv', 'cv', 'c'],
  block:    ['blck', 'blk', 'bl'],
  bust:     ['bst', 'bt'],
  automute: [],
  median:   ['med'],
  prob:     ['prb', 'pob', 'pb', 'p'],
  profit:   ['prfit', 'profi', 'prof', 'prft', 'prf', 'prt'],
  sql:      [],
  streak:   [],
  wagered:  ['w', 'wager', 'wagerd', 'wagr', 'wagrd', 'wagred', 'wd',
             'wg', 'wgd', 'wger', 'wgerd', 'wgr', 'wgrd', 'wgred'
            ]
};

let mapAlias = {};
_.forEach(cmdAliases, (aliases, cmd) => {
  // Map each command to itself
  mapAlias[cmd] = cmd;

  // Map alises to command.
  _.forEach(aliases, alias => {
    mapAlias[alias] = cmd;
  });
});

// A list of commands not allows in the english channel.
let cmdBlacklist = [
  'bust', 'convert', 'median', 'prob', 'profit', 'streak', 'wagered'
];

/* eslint complexity: [2,16] */
Shiba.prototype.onCmd = function*(msg, cmd, rest) {
  debug('Handling cmd %s', cmd);

  // Cmd rate limiter
  if (yield* this.checkCmdRate(msg)) return;

  // Lookup proper command name or be undefined.
  cmd = mapAlias[cmd.toLowerCase()];

  // Check if a blacklisted command is used in the english channel.
  if (msg.channelName === 'english' &&
      cmdBlacklist.indexOf(cmd) >= 0 &&
      Config.USER_WHITELIST.indexOf(msg.username.toLowerCase()) < 0) {
    this.webClient.doSay(
      '@' + msg.username +
        ' Please use the SPAM channel for that command.',
      msg.channelName
    );
    return;
  }

  switch(cmd) {
  case 'automute':
    yield* this.cmdAutomute.handle(this.webClient, msg, rest);
    break;
  case 'block':
    yield* this.cmdBlock.handle(this.webClient, msg, rest);
    break;
  case 'bust':
    yield* this.cmdBust.handle(this.webClient, this.client, msg, rest);
    break;
  case 'convert':
    yield* this.onCmdConvert(msg, rest);
    break;
  case 'custom':
    yield* this.onCmdCustom(msg, rest);
    break;
  case 'help':
    yield* this.onCmdHelp(msg, rest);
    break;
  case 'lick':
    yield* this.onCmdLick(msg, rest);
    break;
  case 'median':
    yield* this.cmdMedian.handle(this.webClient, msg, rest);
    break;
  case 'prob':
    yield* this.cmdProb.handle(this.webClient, msg, rest);
    break;
  case 'profit':
    yield* this.cmdProfit.handle(this.webClient, msg, rest);
    break;
  case 'seen':
    yield* this.onCmdSeen(msg, rest);
    break;
  case 'sql':
    yield* this.cmdSql.handle(this.webClient, msg, rest);
    break;
  case 'streak':
    yield* this.cmdStreak.handle(this.webClient, msg, rest);
    break;
  case 'wagered':
    yield* this.cmdWagered.handle(this.webClient, msg, rest);
    break;
  default:
  }
};

Shiba.prototype.onCmdHelp = function*(msg, rest) {
  this.webClient.doSay(
      'very explanation. much insight: ' +
      'https://github.com/moneypot/shiba/wiki/', msg.channelName);
};

Shiba.prototype.onCmdCustom = function*(msg, rest) {
  if (msg.role !== 'admin' &&
      msg.role !== 'moderator') return;

  let customReg   = /^([a-z0-9_\-]+)\s+(.*)$/i;
  let customMatch = rest.match(customReg);
  let doSay       = text => this.webClient.doSay(text, msg.channelName);

  if (!customMatch) {
    doSay('wow. very usage failure. such retry');
    doSay('so example, very cool: !custom Ryan very dog lover');
    return;
  }

  let customUser  = customMatch[1];
  let customMsg   = customMatch[2];

  try {
    yield* Pg.putLick(customUser, customMsg, msg.username);
    doSay('wow. so cool. very obedient');
  } catch(err) {
    console.error('[ERROR] onCmdCustom:', err.stack);
    doSay('wow. such database fail');
  }
};

Shiba.prototype.onCmdLick = function*(msg, user) {
  user = user.toLowerCase();

  // We're cultivated and don't lick ourselves.
  if (user === this.client.username.toLowerCase()) return;

  let doSay = text => this.webClient.doSay(text, msg.channelName);
  if (profanity[user]) {
    doSay('so trollol. very annoying. such mute');
    this.webClient.doMute(msg.username, '5m', msg.channelName);
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
    doSay(m);
  } catch(err) {
    switch (err) {
    case 'USER_DOES_NOT_EXIST':
      doSay('very stranger. never seen');
      break;
    case 'USERNAME_INVALID':
      doSay('name invalid. you trolling!?');
      break;
    default:
      console.error('[ERROR] onCmdLick:', err);
      break;
    }
  }
};

Shiba.prototype.onCmdSeen = function*(msg, user) {
  user = user.toLowerCase();

  let doSay = text => this.webClient.doSay(text, msg.channelName);
  // Make sure the username is valid
  if (Lib.isInvalidUsername(user)) {
    doSay('such name. very invalid');
    return;
  }

  // In case a user asks for himself.
  if (user === msg.username.toLowerCase()) {
    doSay('go find a mirror @' + msg.username);
    return;
  }

  // Special treatment of block.
  if (user === 'block') {
    yield* this.cmdBlock.handle(this.webClient, msg, user);
    return;
  }

  // Special treatment of rape.
  if (user === 'rape') {
    yield* this.cmdBust.handle(this.webClient, this.client, msg, '< 1.05');
    return;
  }

  // Special treatment of nyan.
  if (user === 'nyan') {
    yield* this.cmdBust.handle(this.webClient, this.client, msg, '>= 1000');
    return;
  }

  // Somebody asks us when we've seen ourselves.
  if (this.client.username && this.client.username.toLowerCase() === user) {
    doSay('strange loops. much confusion.');
    return;
  }

  if (profanity[user]) {
    doSay('so trollol. very annoying. such mute');
    this.webClient.doMute(msg.username, '5m', msg.channelName);
    return;
  }

  let message;
  try {
    message = yield* Pg.getLastSeen(user);
  } catch(err) {
    if (err === 'USER_DOES_NOT_EXIST') {
      doSay('very stranger. never seen');
    } else {
      console.error('[ERROR] onCmdSeen:', err.stack);
      doSay('wow. such database fail');
    }
    return;
  }

  if (!message.time) {
    // User exists but hasn't said a word.
    doSay('very silent. never spoken');
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
  doSay(line);
};

Shiba.prototype.onCmdConvert = function*(msg, conv) {
  yield* this.cmdConvert.handle(this.webClient, msg, conv);
};

let shiba = new Shiba();
