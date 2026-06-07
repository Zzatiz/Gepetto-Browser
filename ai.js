// Subpath entry so the optional AI plugin can be required as:
//   const ai = require('gepetto-browser/ai')
// The core library (require('gepetto-browser')) never loads this file.
module.exports = require('./src/ai');
