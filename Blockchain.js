var _           =  require('lodash');
var Events      =  require('events');
var util        =  require('util');
var WebSocket   =  require('ws');
var debug       =  require('debug')('shiba:blockchain');

module.exports = Blockchain;

function Blockchain() {
  _.extend(this, Events);
  this.socket = new WebSocket('ws://ws.blockchain.info/inv');
  this.socket.on('open', this.onOpen.bind(this));
  this.socket.on('message', this.onMessage.bind(this));
  this.socket.on('error', this.onError.bind(this));
  this.socket.on('close', this.onClose.bind(this));
}

util.inherits(Blockchain, Events.EventEmitter);

Blockchain.prototype.onOpen = function() {
  debug('Connection established.');
  
  // Subscribe to new blocks.
  this.socket.send('{"op":"blocks_sub"}', this.onError.bind(this));

  // Get the latest block.
  this.socket.send('{"op":"ping_block"}', this.onError.bind(this));
  this.emit('connect');
};

Blockchain.prototype.onMessage = function(message, flags) {
  var data = JSON.parse(message);
  debug('Op received', data.op);

  switch (data.op) {
  case 'status':
    debug('Status %s', message);
    break;
  case 'block':
    this.doBlock(data.x);
    break;
  }
};

Blockchain.prototype.onError = function(error) {
  if (error) return console.error(error);
};

Blockchain.prototype.onClose = function(code, message) {
  debug('Connection closed.');
  this.emit('disconnect');
};

Blockchain.prototype.doBlock = function(block) {
  debug('New block #%d Time', block.height, block.time);
  this.emit('block', block);
};
