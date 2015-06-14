'use strict';

const co         = require('co');
const debug      = require('debug')('shiba:cmd:block');
const debugblock = require('debug')('shiba:blocknotify');
const Pg         = require('../Pg');
const Blockchain = require('../Util/Blockchain');
const Lib        = require('../Lib');

function CmdBlock(block, blockNotify) {
  this.block       = block;
  this.blockNotify = blockNotify;
  this.client      = null;

  this.blockchain  = new Blockchain();
  this.blockchain.on('block', this.onBlock.bind(this));
}

CmdBlock.prototype.setClient = function(client) {
  this.client = client;
};

CmdBlock.prototype.onBlock = function(block) {
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

      if (self.client && self.blockNotify.length > 0) {
        let users = self.blockNotify.map(s => '@'+s).join(', ') + ': ';
        let line = users + 'Block #' + newBlock.height + ' mined.';
        self.client.doSay(line);
        self.blockNotify = [];
        yield* Pg.clearBlockNotifications();
      }
    }
  }).catch(err => console.error('[ERROR] onBlock:', err));
};

CmdBlock.prototype.handle = function*(client, msg, input) {

  debug('Handling cmd block for user: %s', msg.username);

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
  if (this.blockNotify.indexOf(msg.username) < 0) {
    debugblock("Adding user '%s' to block notfy list", msg.username);
    this.blockNotify.push(msg.username);
    yield* Pg.putBlockNotification(msg.username);
  } else {
    debugblock("User '%s' is already on block notfy list", msg.username);
    line += ' ' + msg.username + ': Have patience!';
  }

  this.client.doSay(line);
};

function* mkCmdBlock() {
  // Last received block information.
  let block = yield* Pg.getLatestBlock();

  // Awkward name for an array that holds names of users which
  // will be notified when a new block has been mined.
  let blockNotifyUsers = yield* Pg.getBlockNotifications();

  return new CmdBlock(block, blockNotifyUsers);
}

module.exports = exports = mkCmdBlock;
