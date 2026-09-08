// backend/src/models/Setting.js
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['general', 'news', 'ai', 'social', 'scheduler'],
    required: true,
    index: true
  },
  isEncrypted: {
    type: Boolean,
    default: false
  },
  updatedBy: {
    type: String,
    required: true,
    default: 'system'
  }
}, {
  timestamps: true
});

// Method to get setting value with type handling
settingSchema.statics.getValue = async function(key, defaultValue = null) {
  const setting = await this.findOne({ key });
  if (!setting) return defaultValue;
  return setting.value;
};

// Method to set setting value
settingSchema.statics.setValue = async function(key, value, updatedBy = 'system') {
  const setting = await this.findOneAndUpdate(
    { key },
    { value, updatedBy },
    { new: true, upsert: true }
  );
  return setting;
};

// Method to get all settings by category
settingSchema.statics.getByCategory = async function(category) {
  return await this.find({ category }).sort({ key: 1 });
};

module.exports = mongoose.model('Setting', settingSchema);