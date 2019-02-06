/* eslint-env jest */
const path = require('path');
// mock child_process module
const child_process = jest.requireActual('child_process');

// store original function
const spawn = child_process.spawn;

// path to self
const selfPath = path.resolve(__dirname, '../../');

// mock implementation
child_process.spawn = (...args) => {
  if (args[0] === 'yarn') {
    // rewrite install path to install self
    args[1].pop();
    args[1][1] = selfPath;
  }
  return spawn(...args);
};

module.exports = child_process;
