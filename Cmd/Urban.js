'use strict';

const debug = require('debug')('shiba:cmd:urban');
const request = require('co-request');
const wrap = require('word-wrap');
const _ = require('lodash');

const API       = 'http://api.urbandictionary.com/v0/';
const WRAP_OPT  = {width: 495, trim: true, indent:''};

function Urban() {
}

function* define(term) {
  debug('Fetching definition');

  // Compose the final URL.
  let url = API + 'define?term=' + encodeURIComponent(term)
  debug('ud url: %s', url);

  // Fetch the data
  let req = yield request(url);
  let res = JSON.parse(req.body);

  return res;
}

function layout(text) {
  return _.split(wrap(text.replace(/\s+/g, " "), WRAP_OPT), '\n');
}

Urban.prototype.handle = function*(client, msg, input) {

  let result;
  try {
    result = yield* define(input);
    if (!result || !result.result_type) {
      client.doSay('wow. such dictionary fail. very concerning', msg.channelName);
      return;
    }
  } catch(e) {
    console.log(e.stack || e);
    client.doSay(e.toString(), msg.channelName);
  }

  switch(result.result_type) {
  case 'exact':
    let entry = result.list[0];

    // Keep track how much we said.
    let numChars = 0;

    // Output definition
    let defLines = layout("Definition: " + entry.definition.trim());

    for (let line of defLines) {
      if (numChars + line.length <= 800) {
        client.doSay(line, msg.channelName);
        numChars += line.length;
      } else {
        const url =
          'https://urbandictionary.com/define?term=' +
          encodeURIComponent(input);
        client.doSay(line + ' ...', msg.channelName);
        client.doSay('Full definition: ' + url, msg.channelName);
        return;
      }
    }

    // See if example exists
    if (!entry.example || entry.example === "") return;

    // Output example
    let exampleLines = layout("Example: " + entry.example.trim());
    let exampleLength = exampleLines.join('').length;

    // Only say it if it's not too long.
    if (numChars + exampleLength <= 800) {
      for (let line of exampleLines)
        client.doSay(line, msg.channelName);
    }

    break;
  case 'no_results':
    client.doSay('such lolcat. speak doge ffs!', msg.channelName);
    break;
  default:
    console.log('UD returned', result);
    break;
  }
};

module.exports = exports = Urban;
