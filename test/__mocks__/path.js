/* eslint-env jest */
const os = require('os');

// mock path module
const path = jest.requireActual('path');

// store original function
const pathJoin = path.join;

// construct test folder path
const baseFolder = pathJoin(__dirname, '..', 'fixtures', 'config');
const userFolder = [os.homedir(), '.exoframe'];
const publicKeysFolder = [os.homedir(), '.ssh'];

// mock implementation
path.join = (...args) => {
  // override base folder and assign it to fixtures
  if (
    (args[0] === userFolder[0] && args[1] === userFolder[1]) ||
    (args[0] === publicKeysFolder[0] && args[1] === publicKeysFolder[1])
  ) {
    return baseFolder;
  }
  return pathJoin(...args);
};

module.exports = path;
