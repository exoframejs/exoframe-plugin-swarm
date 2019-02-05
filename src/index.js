const config = require('./config');
const init = require('./init');
const {start, startFromParams} = require('./start');
const list = require('./list');
const logs = require('./logs');
const remove = require('./remove');
const compose = require('./compose');

module.exports = {
  config,
  // functions
  init,
  start,
  startFromParams,
  list,
  logs,
  remove,
  // template extensions
  compose,
};
