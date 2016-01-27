'use strict';

const EventEmitter =  require('events').EventEmitter;
const inherits     =  require('util').inherits;
const io           =  require('socket.io-client');
const debug        =  require('debug')('shiba:webclient');
const debugchat    =  require('debug')('shiba:chat');

module.exports = WebClient;

function WebClient(config) {
  EventEmitter.call(this);

  // Save configuration and stuff.
  this.config = config;

  let opts = {
    extraHeaders: {
      Cookie: 'id=' + config.SESSION
    }
  };

  debug('Setting up connection to %s', config.WEBSERVER);
  this.socket = io(config.WEBSERVER, opts);
  this.socket.on('error', this.onError.bind(this));
  this.socket.on('err', this.onErr.bind(this));
  this.socket.on('connect', this.onConnect.bind(this));
  this.socket.on('disconnect', this.onDisconnect.bind(this));
  this.socket.on('msg', this.onMsg.bind(this));
}

inherits(WebClient, EventEmitter);

WebClient.prototype.onMsg = function(msg) {
  debugchat('Msg: %s', JSON.stringify(msg));

  if (!msg.channelName)
    console.log('[WebClient.onMsg]', 'Received message with no channel');

  this.emit('msg', msg);
};

WebClient.prototype.onError = function(err) {
  if (err instanceof Error && err.type === 'TransportError')
    debug('Transport closed');
  else
    console.error('[Webclient.onError]', err);
};

WebClient.prototype.onErr = function(err) {
  console.error('[Webclient.onErr]', err);
};

WebClient.prototype.onConnect = function(data) {
  debug('Web Server Connected. Received: %s', JSON.stringify(data));
  this.socket.emit('join', 'all', this.onJoin.bind(this));
};

/**
 * Called after joining the 'all' channel.
 * @param {?} err - Error reported by server.
 * @param {?object} data - Data received after a succesful join.
 * @param {string} data.username - The username of the connecting client.
 * @param {string} data.moderator - If the user is a moderator.
 * @param {object[]} data.channels - Joined channels history.
 */
WebClient.prototype.onJoin = function(err, data) {
  if (err)
    console.error('[WebClient.onJoin]', err);
  else
    debug('Chat joined');

  var allChanData = {
    history: data.channels.all,
    username: data.username,
    channel: 'all'
  };

  this.emit('join', allChanData);
};

WebClient.prototype.doSay = function(line, channelName) {
  debugchat('Saying: %s', line);

  this.socket.emit('say', line, channelName, true, function(err) {
    if (err)
      console.error('[WebClient.doSay]', err);
  });
};

WebClient.prototype.onDisconnect = function(data) {
  debug('Web client disconnected |', data, '|', typeof data);
  this.emit('disconnect');
};

WebClient.prototype.doMute = function(user, timespec, channelName) {
  if (this.config.USER_WHITELIST.indexOf(user.toLowerCase()) < 0) {
    debugchat('Muting user: %s time: %s', user, timespec);
    let line = '/mute ' + user;
    if (timespec) line = line + ' ' + timespec;
    this.socket.emit('say', line, channelName, true, function(err) {
      if (err)
        console.error('[WebClient.doMute]', err);
    });
  } else {
    debugchat('Not muting whitelisted user: %s time: %s', user, timespec);
  }
};
