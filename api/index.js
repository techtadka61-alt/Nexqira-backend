// Vercel Serverless Function entry
// This exposes the Express app as a handler.
const app = require('../src/app');

module.exports = (req, res) => app(req, res);
