'use strict';

const debug = require('debug')('shiba:store:automute');
const Pg    = require('../Pg');

function Automute(store) {
  debug('Initializing automute store:');
  for (let mute of store)
    debug('' + mute);

  this.store = store;
}

Automute.prototype.add = function*(username, regexp) {
  debug('Adding automute: ' + regexp);
  console.assert(regexp instanceof RegExp);

  yield* Pg.addAutomute(username, regexp);
  this.store.push(regexp);
};

Automute.prototype.get = function() {
  return this.store;
};

function* make() {
  debug('Create automute store');
  return new Automute(yield* Pg.getAutomutes());
}

module.exports = exports = make;
