'use strict';

const EventEmitter =  require('events').EventEmitter;
const inherits     =  require('util').inherits;
const WebSocket    =  require('ws');
const debug        =  require('debug')('shiba:blockchain');

function Blockchain() {
  EventEmitter.call(this);
  this.pingTimeoutTimer  = null;
  this.pingTimeout       = 5000;
  this.pingIntervalTimer = null;
  this.pingInterval      = 45000;
  this.reconnectInterval = 60000;
  this.doConnect();
}

inherits(Blockchain, EventEmitter);

Blockchain.prototype.doScheduleConnect = function() {
  debug('Reconnecting in %d ms.', this.reconnectInterval);
  setTimeout(this.doConnect.bind(this), this.reconnectInterval);

  clearTimeout(this.pingIntervalTimer);
  clearTimeout(this.pingTimeoutTimer);
  if (this.socket) {
    this.socket.removeAllListeners();
    this.socket = null;
  }
};

Blockchain.prototype.doConnect = function() {
  debug('Connecting to Blockchain API.');
  let self = this;
  let socket = new WebSocket('wss://ws.blockchain.info/inv');
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
  try {
    let data = JSON.parse(message);
    debug("Op received: '%s'.", data.op);

    switch (data.op) {
    case 'status':
      debug('Status %s', message);
      break;
    case 'block':
      debug('New block #%d, time %d.', data.x.height, data.x.time);
      this.emit('block', data.x);
      break;
    }
  } catch (e) {
    console.error("Error while decoding message:", e.message);
    console.error(e.stack);
  }

  this.resetPingTimer();
};

Blockchain.prototype.onError = function(error) {
  if (error) {
    debug('Connection error: ' + error);
    this.doScheduleConnect();
  }
};

Blockchain.prototype.onClose = function(code, message) {
  debug('Connection closed with code %s: %s.', JSON.stringify(code), message);
  this.doScheduleConnect();
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
  try {
    this.socket.ping();
    this.pingTimeoutTimer =
      setTimeout(this.onPingTimeout.bind(this),
                 this.pingTimeout);
  } catch(err) {
    // Usually thrown when socket is closed.
    console.error('[ERROR] Blockchain::onPingInterval,', err);
    this.onClose();
  }
};

Blockchain.prototype.onPingTimeout = function() {
  debug('Ping timed out. Closing connection.');
  this.socket.close();
};

Blockchain.prototype.onPong = function() {
  debug('Pong received.');
  this.resetPingTimer();
};

module.exports = Blockchain;
