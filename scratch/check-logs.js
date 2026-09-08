const connectDB = require('../src/config/db');
const Log = require('../src/models/Log');
require('dotenv').config();

async function checkLogs() {
  try {
    await connectDB();
    const logs = await Log.find().sort({ createdAt: -1 }).limit(10);
    console.log('Recent Logs:');
    console.log(JSON.stringify(logs, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkLogs();
