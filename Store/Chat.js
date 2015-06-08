'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const debug        = require('debug')('shiba:store:chat');
const debugv       = require('debug')('verbose:store:chat');
const Pg           = require('../Pg');

function ChatStore(store, writeToDb) {
  debug('Initializing chat store');
  EventEmitter.call(this);

  // This array holds all the chat messages sorted from
  // old to new.
  this.store = store || [];
  this.writeToDb = writeToDb;
}

inherits(ChatStore, EventEmitter);

function eqMsg(a,b) {
  let res =
    a.message   == b.message   &&
    a.moderator == b.moderator &&
    a.type      == b.type      &&
    a.username  == b.username  &&
    new Date(a.time).getTime() ==
    new Date(b.time).getTime();
  return res;
}

ChatStore.prototype.mergeMessages = function*(msgs) {
  let self = this;
  let na   = msgs, oa = this.store;
  let m    = [];
  let ni   = 0, oi = 0;

  while (true) {
    if (!(oi < oa.length)) {
      // No more old messages just import the new ones.
      let msgs = na.splice(ni);
      if (msgs.length > 0)
        debug('Importing new messages: %s', JSON.stringify(msgs, null, ' '));

      this.store = m;
      for (let msg of msgs)
        yield* this.addMessage(msg);
      return;
    }

    if (!(ni < na.length)) {
      // All new messages added, but some old messages are left for
      // merging. Under normal circumstances this should be
      // impossible.
      let msgs = oa.splice(oi);
      console.error('[ERROR] Stray old messages:', msgs, na, oa);
      this.store = m.concat(msgs);
      return;
    }

    // Extract old and new messages and message times.
    let om = oa[oi], ot = new Date(om.time);
    let nm = na[ni], nt = new Date(nm.time);

    if (ot < nt) {
      debugv('Merge old message: %s', JSON.stringify(om));
      m.push(om);
      oi++;
      continue;
    } else if (nt < ot) {
      debugv('Merge new message: %s', JSON.stringify(nm));
      try {
        if (self.writeToDb)
          yield* Pg.putMsg(nm);
      } catch(err) {
        console.error('Failed to log msg:', nm, '\nError:', err);
      }
      m.push(nm);
      ni++;
      continue;
    } else if (eqMsg(om,nm)) {
      debugv('Merge common message: %s', JSON.stringify(nm));
      m.push(nm);
      oi++;
      ni++;
      continue;
    } else {
      // Can't figure out correct ordering without more complex code.
      // console.error('[ERROR] Merging messages:', na, oa);
      m.push(om);
      oi++;
      continue;
    }
  }
};

ChatStore.prototype.addMessage = function*(msg) {
  debug('Adding message: ' + JSON.stringify(msg));

  try {
    if (this.writeToDb)
      yield* Pg.putMsg(msg);
  } catch(err) {
    console.error('Failed to log msg:', msg, '\nError:', err);
  }

  if (this.store.length >= 100)
    this.store.shift();

  this.store.push(msg);
  this.emit('msg', msg);
};

ChatStore.prototype.getChatMessages = function(username, after) {
  let messages = [];
  for (let msg of this.store) {
    let then = new Date(msg.time);

    if (after <= then &&
        msg.type === 'say' &&
        msg.username === username)
      messages.push(msg);
  }
  return messages;
};

ChatStore.prototype.get = function() {
  return this.store;
};

function* make(writeToDb) {
  debug('Create chat store');
  let msgs = yield* Pg.getLastMessages();
  return new ChatStore(msgs, writeToDb);
}

module.exports = exports = make;
