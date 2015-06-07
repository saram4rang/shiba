'use strict';

const debug = require('debug')('shiba:cmd:automute');

function Automute(store) {
  this.store = store;
}

Automute.prototype.handle = function*(client, msg, input) {

  if (msg.role !== 'admin' &&
      msg.role !== 'moderator') return;

  let regex;
  try {
    let match = input.match(/^\/(.*)\/([gi]*)$/);
    regex = new RegExp(match[1], match[2]);
  } catch(err) {
    client.doSay('regex compile file: ' + err.message);
    return;
  }

  try {
    yield* this.store.add(msg.username, regex);
  } catch(err) {
    client.doSay('failed adding automute to database.');
    return;
  }

  client.doSay('wow. so cool. very obedient');
};

module.exports = exports = Automute;
