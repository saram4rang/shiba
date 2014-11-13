var _           =  require('lodash');
var Events      =  require('events');
var util        =  require('util');
var WebSocket   =  require('ws');
var debug       =  require('debug')('shiba:blockchain');

module.exports = Blockchain;

function Blockchain() {
  _.extend(this, Events);
  this.pingTimeoutTimer  = null;
  this.pingTimeout       = 5000;
  this.pingIntervalTimer = null;
  this.pingInterval      = 30000;
  this.reconnectInterval = 30000;
  this.doConnect();
}

util.inherits(Blockchain, Events.EventEmitter);

Blockchain.prototype.doConnect = function() {
  debug('Connecting to Blockchain API.');
  var self = this;
  var socket = new WebSocket('ws://ws.blockchain.info/inv');
  socket.on('error', self.onError.bind(self));
  socket.on('open', function() {
    self.socket = socket;
    self.socket.on('message', self.onMessage.bind(self));
    self.socket.on('close', self.onClose.bind(self));
    self.socket.on('pong', self.onPong.bind(self));
    self.onOpen();
  });
};

Blockchain.prototype.onOpen = function() {
  debug('Connection established.');

  // Subscribe to new blocks.
  this.socket.send('{"op":"blocks_sub"}', this.onError.bind(this));

  // Get the latest block.
  this.socket.send('{"op":"ping_block"}', this.onError.bind(this));

  this.resetPingTimer();
  this.emit('connect');
};


Blockchain.prototype.onMessage = function(message, flags) {
  var data = JSON.parse(message);
  debug("Op received: '%s'.", data.op);

  switch (data.op) {
  case 'status':
    debug('Status %s', message);
    break;
  case 'block':
    var block = data.x;
    debug('New block #%d, time %d.', block.height, block.time);
    this.emit('block', block);
    break;
  }

  this.resetPingTimer();
};

Blockchain.prototype.onError = function(error) {
  if (error) return console.error(error);
};

Blockchain.prototype.onClose = function(code, message) {
  debug('Connection closed. Reconnecting in %d ms.', this.reconnectInterval);
  setTimeout(this.doConnect.bind(this), this.reconnectInterval);

  clearTimeout(this.pingIntervalTimer);
  clearTimeout(this.pingTimeoutTimer);
  this.socket.removeAllListeners();
  this.socket = null;
  this.emit('disconnect');
};

Blockchain.prototype.resetPingTimer = function() {
  debug('Resetting ping interval timer: %d ms.', this.pingInterval);
  clearTimeout(this.pingIntervalTimer);
  clearTimeout(this.pingTimeoutTimer);
  this.pingIntervalTimer =
    setTimeout(this.onPingInterval.bind(this),
               this.pingInterval);
};


Blockchain.prototype.onPingInterval = function() {
  debug('Ping interval. Sending ping. Timeout: %d ms.', this.pingTimeout);
  this.socket.ping();
  this.pingTimeoutTimer =
    setTimeout(this.onPingTimeout.bind(this),
               this.pingTimeout);
};

Blockchain.prototype.onPingTimeout = function() {
  debug('Ping timed out. Closing connection.');
  this.socket.close();
};

Blockchain.prototype.onPong = function() {
  debug('Pong received.');
  this.resetPingTimer();
};
