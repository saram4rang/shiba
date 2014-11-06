var fs           =  require('fs');
var async        =  require('async');
var profanity    =  require('./profanity');
var Bitstamp     =  require('./Bitstamp');

var Client       =  require('./Client');
var Db           =  require('./Db');
var Config       =  require('./Config')();

// Command syntax
var cmdReg = /^!([a-zA-z]*)\s*(.*)$/;

function Shiba() {
  this.client = new Client(Config);

  this.setupUsernameScrape();
  this.setupConsoleLog();
  this.setupLossStreakComment();
  this.setupScamComment();
}

Shiba.prototype.setupUsernameScrape = function() {
  var self = this;
  self.client.on('player_bet', function(data) {
    Db.putUsername(data.username);
  });
  self.client.on('msg', function(msg) {
    if (msg.type != 'say') return;
    Db.putUsername(msg.username);
    Db.updateSeen(msg.username, msg);
    self.onSay(msg);
  });
};

Shiba.prototype.setupConsoleLog = function() {
  var self = this;
  self.client.on('game_starting', function(info) {
    var line = "Starting " + info.game_id
        + " " + info.hash.substring(0,8);
    process.stdout.write(line);
  });

  self.client.on('game_started', function(data) {
    process.stdout.write(".. ");
  });

  self.client.on('game_crash', function(data) {
    var gameInfo = self.client.getGameInfo();
    var crash = (data.game_crash/100).toFixed(2)
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

Shiba.prototype.getChatMessages = function(username, after) {
  var messages = [];
  var chatHistory = this.client.chatHistory;
  for (var i = 0; i < chatHistory.length; ++i) {
    then = new Date(chatHistory[i].time);
    if (then < after) break;

    if (chatHistory[i].username == username)
      messages.push(chatHistory[i]);
  }
  return messages;
};

Shiba.prototype.onSay = function(msg) {
  if (msg.username == this.client.username) return;

  // Coinurl blocking
  var coinurlReg = /http:\/\/cur\.lv\/.*/i;
  var coinurlMatch = msg.message.match(coinurlReg);
  if (coinurlMatch) return this.client.doMute(msg.username, '6h');

  // Minefield blocking
  var minefieldReg = /minefield\.bitcoinlab\.org\/.*(\?|&)r=/i;
  var minefieldMatch = msg.message.match(minefieldReg);
  if (minefieldMatch) return this.client.doMute(msg.username, '6h');

  // Cloud mining
  var cloudmineReg = /cloud.*mining.*http:\/\/vk\.cc\/[0-9a-z]/i;
  var cloudmineMatch = msg.message.match(minefieldReg);
  if (cloudmineMatch) return this.client.doMute(msg.username, '6h');

  var after, messages;
  // Rate limiter 5 messages in 5s
  after    = new Date(Date.now() - 5000);
  messages = this.getChatMessages(msg.username, after);
  if (messages.length >= 6) return this.client.doMute(msg.username, '15m');

  // Rate limiter 8 messages in 12s
  after    = new Date(Date.now() - 12000);
  messages = this.getChatMessages(msg.username, after);
  if (messages.length >= 9) return this.client.doMute(msg.username, '15m');

  var cmdMatch = msg.message.match(cmdReg);
  if (cmdMatch) this.onCmd(msg, cmdMatch[1], cmdMatch[2]);
};

Shiba.prototype.onCmd = function(msg, cmd, rest) {
  // Cmd rate limiter
  var after    = new Date(Date.now() - 10000);
  var messages = this.getChatMessages(msg.username, after);
  var rate = 0;

  for (var i = 0; i < messages.length; ++i)
    if (messages[i].message.match(cmdReg)) ++rate;

  if (rate >= 4)
    return this.client.doMute(msg.username, '5m');
  else if (rate >= 3)
    return this.client.doSay('bites ' + msg.username);

  switch(cmd) {
  case 'custom': this.onCustom(msg, rest); break;
  case 'lick': this.onLick(msg, rest); break;
  case 'seen': this.onSeen(msg, rest); break;
  case 'convert': this.onConvert(msg, rest); break;
  }
};

Shiba.prototype.onCustom = function(msg, rest) {
  var self = this;
  if (msg.role != 'admin' &&
      msg.role != 'moderator') return;

  var customReg   = /^([A-Za-z0-9]*)\s*(.*)$/;
  var customMatch = rest.match(customReg);
  var customUser  = customMatch[1];
  var customMsg   = customMatch[2];
  Db.addCustomLickMessage(customUser, customMsg, function (err) {
    if (err) {
      console.log('onCustom:', err);
      self.client.doSay('wow. such leveldb fail');
    } else {
      self.client.doSay('wow. so cool. very obedient');
    }
  });
};

Shiba.prototype.onLick = function(msg, user) {
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

  async.parallel(
    [ function(cb) { Db.getUsername(user, cb); },
      function(cb) { Db.getCustomLickMessages(user, cb); }
    ], function (err, val) {
      if (err) return;

      var username = val[0];
      var customs  = val[1];
      customs.push('licks ' + username);
      var r = Math.random() * (customs.length - 0.8);
      var m = customs[Math.floor(r)];
      self.client.doSay(m);
    });
};

Shiba.prototype.onSeen = function(msg, user) {
  var self = this;
  user = user.toLowerCase();
  user = user.replace(/^\s+|\s+$/g,'');

  // Avoid this.
  if (user === self.client.username.toLowerCase()) return;

  if (profanity[user]) {
    self.client.doSay('so trollol. very annoying. such mute');
    self.client.doMute(msg.username, '5m');
    return;
  }

  async.parallel(
    [ function(cb) { Db.getUsername(user, cb); },
      function(cb) { Db.getSeen(user, cb); }
    ], function (err, val) {
      if (err) return;

      var username = val[0];
      var msg      = val[1];
      var time = new Date(msg.time);
      var diff = Date.now() - time;

      var line;
      if (diff < 1000) {
        line = 'Seen ' + username + ' just now.';
      } else {
        var ms = diff % 1000; diff = Math.floor(diff/1000);
        var s  = diff % 60;   diff = Math.floor(diff/60);
        var m  = diff % 60;   diff = Math.floor(diff/60);
        var h  = diff % 24;   diff = Math.floor(diff/24);
        var d  = diff;

        var line = 'Seen ' + username;
        if (d > 0) line = line + ' ' + d + 'd';
        if (h > 0) line = line + ' ' + h + 'h';
        if (m > 0) line = line + ' ' + m + 'm';
        if (s > 0) line = line + ' ' + s + 's';
        line += ' ago.';
      }

      self.client.doSay(line);
    });
};

Shiba.prototype.onConvert = function(msg, conv) {
  var self = this;
  conv = conv.replace(/^\s+|\s+$/g,'');
  var convReg = /^((-|\+)?[0-9]*\.?[0-9]*)(k?)\s*(bits?|btc)$/i;
  var convMatch = conv.match(convReg);

  if (convMatch) {
    Bitstamp.getAveragePrice(function(err, price) {

      console.log(convMatch);
      var amount   = parseFloat(convMatch[1], 10);
      var modifier = convMatch[3];
      var currency = convMatch[4].toLowerCase();

      if (currency === 'btc') {
        usd    = amount * price;
        amount *= 1000000;
        if (modifier === 'k' || modifier === 'K') {
          amount *= 1000;
          usd *= 1000;
        }
        self.client.doSay(conv + ' is ' + amount + ' Bit ' + usd + ' USD');
      } else {
        usd = amount * price;
        if (modifier === 'k' || modifier === 'K') {
          amount /= 1000;
          usd /= 1000;
        }
        else {
          amount /= 1000000;
          usd /= 1000000;
        }
        amount = amount.toFixed(8);
        amount = amount.replace(/\.0*$|0*$/,'');
        self.client.doSay(conv + ' is ' + amount + ' BTC ' + usd + ' USD');
      }
    });
  } else {
    self.client.doSay('usage: !convert <number>k? (btc|bit[s])');
  }
};

var shiba = new Shiba();
