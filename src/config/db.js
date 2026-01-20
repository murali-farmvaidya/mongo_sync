const mongoose = require('mongoose');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.isConnected = false;
  }

  async connect() {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pipecat_sync';
      const dbName = process.env.MONGODB_DB_NAME || 'pipecat_sync';
      
      await mongoose.connect(uri, {
        dbName,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      this.isConnected = true;
      logger.info('✅ MongoDB connected successfully');
      
      // Handle connection events
      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
        this.isConnected = false;
      });
      
      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.isConnected = false;
      });
      
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });
      
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
    }
  }

  getConnection() {
    return mongoose.connection;
  }
}

// Define schemas
const agentSchema = new mongoose.Schema({
  agent_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  agent_name: {
    type: String,
    required: true,
    index: true
  },
  name: String,
  description: String,
  config: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed,
  created_at: Date,
  updated_at: Date,
  last_synced_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'db_created_at', updatedAt: 'db_updated_at' }
});

const sessionSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  agent_id: {
    type: String,
    required: true,
    index: true
  },
  agent_name: {
    type: String,
    required: true,
    index: true
  },
  status: String,
  started_at: Date,
  ended_at: Date,
  metadata: mongoose.Schema.Types.Mixed,
  last_synced_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'db_created_at', updatedAt: 'db_updated_at' }
});

const logSchema = new mongoose.Schema({
  log_id: {
    type: String,
    required: true,
    unique: true
  },
  session_id: {
    type: String,
    required: true,
    index: true
  },
  agent_id: {
    type: String,
    required: true,
    index: true
  },
  agent_name: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  level: String,
  message: String,
  data: mongoose.Schema.Types.Mixed,
  created_at: Date
}, {
  timestamps: { createdAt: 'db_created_at' }
});

// Create models
const Agent = mongoose.model('Agent', agentSchema);
const Session = mongoose.model('Session', sessionSchema);
const Log = mongoose.model('Log', logSchema);

// Create indexes
async function createIndexes() {
  try {
    await Agent.createIndexes();
    await Session.createIndexes();
    await Log.createIndexes();
    
    // Additional composite indexes for better query performance
    await Session.collection.createIndex({ agent_id: 1, started_at: -1 });
    await Log.collection.createIndex({ session_id: 1, timestamp: 1 });
    await Log.collection.createIndex({ agent_id: 1, timestamp: 1 });
    
    logger.info('✅ Database indexes created');
  } catch (error) {
    logger.error('Error creating indexes:', error);
  }
}

module.exports = {
  Database,
  Agent,
  Session,
  Log,
  createIndexes
};