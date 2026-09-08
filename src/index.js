// backend/src/index.js (local/VPS server)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = require('./app');

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Blog API available at: http://localhost:${PORT}/api/v1/blog`);
});

// Initialize background scheduler
if (String(process.env.DISABLE_SCHEDULER || '').toLowerCase() === 'true') {
  console.log('⏸️ Scheduler disabled (DISABLE_SCHEDULER=true)');
} else {
  try {

    const PostScheduler = require('./workers/post-scheduler');
    const scheduler = new PostScheduler();
    scheduler.initialize();

    console.log('✅ Scheduler initialized and running');
  } catch (err) {
    console.error('Failed to initialize PostScheduler:', err.message || err);
  }
}
