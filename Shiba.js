var fs           =  require('fs');
var async        =  require('async');
var unshort      =  require('unshort');
var profanity    =  require('./profanity');
var Bitstamp     =  require('./Bitstamp');
var Blockchain   =  require('./Blockchain');

var Client       =  require('./Client');
var Lib          =  require('./Lib');
var Db           =  require('./Db');
var Config       =  require('./Config')();

var debug        =  require('debug')('shiba');
var debugunshort =  require('debug')('shiba:unshort');

// Command syntax
var cmdReg = /^!([a-zA-z]*)\s*(.*)$/i;

function Shiba() {
  this.client = new Client(Config);

  this.setupUsernameScrape();
  this.setupConsoleLog();
  this.setupLossStreakComment();
  this.setupScamComment();
  this.setupBlockchain();
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
    var line =
        "Starting " + info.game_id +
        " " + info.hash.substring(0,8);
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
  var bc = new Blockchain();

  bc.on('block', function(block) {
    Db.put('block', block);
  });
};

Shiba.prototype.getChatMessages = function(username, after) {
  var messages = [];
  var chatHistory = this.client.chatHistory;
  for (var i = 0; i < chatHistory.length; ++i) {
    then = new Date(chatHistory[i].time);
    if (then < after) break;

    if (chatHistory[i].type === 'say' &&
        chatHistory[i].username === username)
      messages.push(chatHistory[i]);
  }
  return messages;
};

Shiba.prototype.onSay = function(msg) {
  if (msg.username === this.client.username) return;

  var regexs  = [ /cloud.*mining.*vk\.cc\/[0-9a-z]/i,
                  /cur\.lv\/.*/i,
                  /minefield\.bitcoinlab\.org\/.*(\?|&)r=/i,
                  /strongbank\.biz\/\?.*ref=.*/i,
                  /satoshimines\.com\/a\/[^\s]+/i,
                  /hashprofit.com\/.*\?.*hp=[0-9]*/i
                ];

  // Match entire message against the regular expressions.
  for (var r = 0; r < regexs.length; ++r)
    if (msg.message.match(regexs[r]))
      return this.client.doMute(msg.username, '6h');

  // Extract a list of URLs.
  // TODO: The regular expression could be made more intelligent.
  var urls = msg.message.match(/https?:\/\/[^\s]+/ig) || [];

  var urls2 = msg.message.match(/(\s|^)bit.ly\/[^s]+/ig);
  if (urls2) {
    for (var i = 0; i < urls2.length; ++i)
      urls2[i] = 'http://' + urls2[i].replace(/^\s+/g,'');
    urls = urls.concat(urls2);
  }
  var urls3 = msg.message.match(/(\s|^)goo.gl\/[^s]+/ig);
  if (urls3) {
    for (var i = 0; i < urls3.length; ++i)
      urls3[i] = 'http://' + urls3[i].replace(/^\s+/g,'');
    urls = urls.concat(urls3);
  }

  if (urls.length > 0)
    debugunshort('Found urls:' + JSON.stringify(urls));

  // Unshorten extracted URLs.
  var self = this;
  async.map(urls, unshort, function(err, urls2) {
    debugunshort('Unshorted finished: ' + JSON.stringify(urls2));

    if (err) {
      console.error("Got error while unshortening: '" + err + "'");
      console.error("Urls was:", JSON.stringify(urls));
      console.error("Urls2 is:", JSON.stringify(urls2));
    }
    urls = urls.concat(urls2);

    debugunshort('Url list: ' + JSON.stringify(urls));
    for (var i = 0; i < urls.length; ++i) {
      var url    = urls[i];
      if (typeof url != 'string') continue;
      debugunshort('Checking url: ' + url);

      // Run the regular expressions against the unshortened url.
      for (var r = 0; r < regexs.length; ++r)
        if (url.match(regexs[r])) {
          debugunshort('URL matched ' + regexs[r]);
          return self.client.doMute(msg.username, '24h');
        }
    }

    var after, messages;
    // Rate limiter < 4 messages in 1s
    after    = new Date(Date.now() - 1000);
    messages = self.getChatMessages(msg.username, after);
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
    var cmdMatch = msg.message.match(cmdReg);
    if (cmdMatch) self.onCmd(msg, cmdMatch[1], cmdMatch[2]);
  });
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

  switch(cmd.toLowerCase()) {
  case 'custom': this.onCmdCustom(msg, rest); break;
  case 'lick': this.onCmdLick(msg, rest); break;
  case 'seen': this.onCmdSeen(msg, rest); break;
  case 'convert': this.onCmdConvert(msg, rest); break;
  case 'block': this.onCmdBlock(msg, rest); break;
  }
};

Shiba.prototype.onCmdCustom = function(msg, rest) {
  var self = this;
  if (msg.role != 'admin' &&
      msg.role != 'moderator') return;

  var customReg   = /^([A-Za-z0-9]*)\s*(.*)$/;
  var customMatch = rest.match(customReg);
  var customUser  = customMatch[1];
  var customMsg   = customMatch[2];
  Db.addCustomLickMessage(customUser, customMsg, function (err) {
    if (err) {
      console.log('onCmdCustom:', err);
      self.client.doSay('wow. such leveldb fail');
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

  async.parallel(
    [ function(cb) { Db.getUsername(user, cb); },
      function(cb) { Db.getCustomLickMessages(user, cb); }
    ],
    function (err, val) {
      if (err) return;

      var username = val[0];
      var customs  = val[1];
      customs.push('licks ' + username);
      var r = Math.random() * (customs.length - 0.8);
      var m = customs[Math.floor(r)];
      self.client.doSay(m);
    });
};

Shiba.prototype.onCmdSeen = function(msg, user) {
  var self = this;
  user = user.toLowerCase();
  user = user.replace(/^\s+|\s+$/g,'');

  // Special treatment of block.
  if (user === 'block') return this.onCmdBlock();

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
    ],
    function (err, val) {
      if (err) return;

      var username = val[0];
      var msg      = val[1];
      var time     = new Date(msg.time);
      var diff     = Date.now() - time;

      var line;
      if (diff < 1000) {
        line = 'Seen ' + username + ' just now.';
      } else {
        line = 'Seen ' + username + ' ';
        line += Lib.formatTimeDiff(diff);
        line += ' ago.';
      }

      self.client.doSay(line);
    });
};

Shiba.prototype.onCmdConvert = function(msg, conv) {
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
      } else if (currency === 'bits' || currency === 'bit') {
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
      } else if (currency === 'usd') {
        var usdAmount = amount;
        var btcAmount = usdAmount / price;
        var bitAmount = btcAmount * 1000000;

        if (modifier === 'k' || modifier === 'K') {
          btcAmount *= 1000;
          bitAmount *= 1000;
        }
        
        +btcAmount = btcAmount.toFixed(8);
+        bitAmount = bitAmount.toFixed(2);
        self.client.doSay(conv + ' is ' + bitAmount + ' Bit(s) ' + btcAmount + ' BTC');
      }
    });
  } else {
    self.client.doSay('usage: !convert <number>k? (btc|bit[s]|usd)');
  }
};

Shiba.prototype.onCmdBlock = function() {
  var self = this;
  Db.get('block', function(err, block) {
    if (err) return self.client.doSay('wow. such leveldb fail');

    var time     = new Date(block.time * 1000);
    var diff     = Date.now() - time;

    var line = 'Seen block #' + block.height;
    if (diff < 1000) {
      line += ' just now.';
    } else {
      line += ' ';
      line += Lib.formatTimeDiff(diff);
      line += ' ago.';
    }
    self.client.doSay(line);
  });
};

var shiba = new Shiba();
