'use strict';

const debug = require('debug')('shiba:cmd:sql');
const Pg    = require('../Pg');

function Sql() {
}

// TODO: Move somewhere else
function eligible(username, role) {
  if (role === 'admin')
    return true;

  if (username === 'Shiba' ||
      username === 'Steve' ||
      username === 'rapetor' ||
      username === 'kungfuant' ||
      username === 'TheManyFacedGod')
    return true;

  return false;
}

Sql.prototype.handle = function*(client, msg, input) {
  if (!eligible(msg.username, msg.role))
    return;

  debug('Running query: %s', input);

  try {
    let result = yield* Pg.query(input, []);
    if (result.rows.length > 0) {
      client.doSay(JSON.stringify(result.rows[0]));
    } else {
      client.doSay('0 rows');
    }
  } catch(e) {    
    client.doSay(e.toString());
  }
};

module.exports = exports = Sql;
