// backend/src/seeders/admin.seeder.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Setting = require('../models/Setting'); // Make sure this is imported
const connectDB = require('../config/db');
require('dotenv').config();

// Admin user data
const adminData = {
  email: process.env.ADMIN_EMAIL || 'admin@technews.com',
  password: process.env.ADMIN_PASSWORD || 'admin123',
  name: 'Admin',
  role: 'admin',
  isActive: true,
  preferences: {
    notifications: {
      email: true,
      onPostApproval: true,
      onPostFailure: true
    },
    defaultPlatforms: ['blog', 'linkedin']
  }
};

// Default settings
const defaultSettings = [
  {
    key: 'schedule_morning',
    value: '09:00',
    description: 'Morning post schedule time (HH:mm)',
    category: 'scheduler',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'schedule_evening',
    value: '18:00',
    description: 'Evening post schedule time (HH:mm)',
    category: 'scheduler',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'auto_approve',
    value: false,
    description: 'Automatically approve posts without admin review',
    category: 'general',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'linkedin_enabled',
    value: true,
    description: 'Enable LinkedIn auto-posting',
    category: 'social',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'blog_enabled',
    value: true,
    description: 'Enable blog posting',
    category: 'general',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'linkedin_access_token',
    value: process.env.LINKEDIN_ACCESS_TOKEN || '',
    description: 'LinkedIn API access token',
    category: 'social',
    isEncrypted: true,
    updatedBy: 'system'
  },
  {
    key: 'linkedin_user_id',
    value: process.env.LINKEDIN_USER_ID || '',
    description: 'LinkedIn user ID for posting',
    category: 'social',
    isEncrypted: false,
    updatedBy: 'system'
  },
  {
    key: 'grok_api_key',
    value: process.env.GROK_API_KEY || '',
    description: 'Grok AI API key for content generation',
    category: 'ai',
    isEncrypted: true,
    updatedBy: 'system'
  },
  {
    key: 'gnews_api_key',
    value: process.env.GNEWS_API_KEY || '',
    description: 'GNews API key for fetching news',
    category: 'news',
    isEncrypted: true,
    updatedBy: 'system'
  }
];

// Seed admin user
async function seedAdmin() {
  try {
    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminData.email });
    
    if (!existingAdmin) {
      // Create admin user (password will be hashed by pre-save hook)
      const admin = new User(adminData);
      await admin.save();
      console.log('✅ Admin user created successfully!');
      console.log(`   Email: ${adminData.email}`);
      console.log(`   Password: ${adminData.password}`);
    } else {
      console.log('⚠️  Admin user already exists, skipping...');
      // Update password if needed
      if (adminData.password !== 'admin123') {
        existingAdmin.password = adminData.password;
        await existingAdmin.save();
        console.log('✅ Admin password updated!');
      }
    }
  } catch (error) {
    console.error('❌ Error seeding admin:', error.message);
    throw error;
  }
}

// Seed settings
async function seedSettings() {
  try {
    for (const setting of defaultSettings) {
      const existingSetting = await Setting.findOne({ key: setting.key });
      
      if (!existingSetting) {
        await Setting.create(setting);
        console.log(`✅ Setting created: ${setting.key} = ${setting.value}`);
      } else {
        // Update if value changed
        if (existingSetting.value !== setting.value) {
          existingSetting.value = setting.value;
          existingSetting.updatedBy = 'system';
          await existingSetting.save();
          console.log(`✅ Setting updated: ${setting.key} = ${setting.value}`);
        } else {
          console.log(`⚠️  Setting already exists: ${setting.key}`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error seeding settings:', error.message);
    throw error;
  }
}

// Main seed function
async function seedDatabase() {
  try {
    console.log('\n🚀 Starting database seeding...\n');
    console.log('='.repeat(50));
    
    // Connect to MongoDB (shared helper ensures db name)
    await connectDB();
    console.log('✅ Connected to MongoDB\n');
    
    // Seed admin user
    await seedAdmin();
    console.log();
    
    // Seed settings
    await seedSettings();
    console.log();
    
    console.log('='.repeat(50));
    console.log('✅ Database seeding completed successfully!');
    console.log('\n📝 Admin Login Details:');
    console.log(`   Email: ${adminData.email}`);
    console.log(`   Password: ${adminData.password}`);
    console.log('\n🔧 LinkedIn Configuration:');
    console.log(`   Status: ${process.env.LINKEDIN_ACCESS_TOKEN ? '✅ Configured' : '❌ Not configured'}`);
    if (process.env.LINKEDIN_ACCESS_TOKEN) {
      console.log(`   User ID: ${process.env.LINKEDIN_USER_ID}`);
      console.log(`   Token expires in: 60 days`);
    }
    console.log('\n🤖 Grok AI Configuration:');
    console.log(`   Status: ${process.env.GROK_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log('\n📰 News API Configuration:');
    console.log(`   Status: ${process.env.GNEWS_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log('\n');
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB\n');
  }
}

// Run seeder if called directly
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedAdmin, seedSettings, seedDatabase };