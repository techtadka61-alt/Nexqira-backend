const connectDB = require('../src/config/db');
const PostScheduler = require('../src/workers/post-scheduler');
require('dotenv').config();

async function testScheduler() {
  console.log('🚀 Starting local scheduler test...');
  const start = Date.now();
  
  try {
    await connectDB();
    console.log('✅ DB Connected');
    
    const scheduler = new PostScheduler();
    
    // We mock some env vars if needed
    process.env.SCHEDULER_TEST_MODE = 'false'; // Run full logic
    
    console.log('🔄 Running generateAndPostToLinkedIn...');
    await scheduler.generateAndPostToLinkedIn();
    
    const duration = (Date.now() - start) / 1000;
    console.log(`\n✨ Test completed in ${duration}s`);
    
    if (duration > 10) {
      console.warn('\n⚠️ WARNING: Execution took more than 10 seconds.');
      console.warn('Vercel Hobby plan has a 10s timeout. This WILL fail on Vercel.');
    } else {
      console.log('\n✅ Execution is within 10s. Should work on Vercel Hobby.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

testScheduler();
