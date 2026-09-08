// Vercel cron endpoint: triggers one generation run
// Protect this route using a secret header in production.

const connectDB = require('../src/config/db');
const PostScheduler = require('../src/workers/post-scheduler');

module.exports = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] ⏰ Vercel Cron Triggered`);

  try {
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const authHeader = req.headers['authorization'];
      const xSecret = req.headers['x-cron-secret'];
      const got = authHeader ? authHeader.replace('Bearer ', '') : xSecret;
      
      if (got !== expected) {
        console.warn('Unauthorized cron attempt');
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
    }

    console.log('Connecting to DB...');
    await connectDB();
    console.log('DB Connected ✅');

    console.log('Initializing Scheduler...');
    const scheduler = new PostScheduler();
    
    console.log('Starting generation run...');
    await scheduler.generateAndPostToLinkedIn();
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`[${new Date().toISOString()}] ✅ Generation run completed in ${duration}s`);

    return res.json({ 
      success: true, 
      message: 'Generation run completed',
      duration: `${duration}s`
    });
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`[${new Date().toISOString()}] ❌ cron-generate error after ${duration}s:`, err);
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Failed',
      duration: `${duration}s`
    });
  }
};

