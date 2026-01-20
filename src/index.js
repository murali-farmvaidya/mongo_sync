require('dotenv').config();
const logger = require('./utils/logger');
const { Database, createIndexes } = require('./config/db');
const CronScheduler = require('./config/cron');

class Application {
  constructor() {
    this.db = new Database();
    this.cronScheduler = new CronScheduler();
    this.shuttingDown = false;
  }
  
  async start() {
    try {
      logger.info('🚀 Starting Pipecat MongoDB Sync Service');
      
      // Connect to MongoDB
      await this.db.connect();
      await createIndexes();
      
      // Start cron scheduler
      this.cronScheduler.start();
      
      // Set up graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('✅ Service started successfully');
      
      // Log status periodically
      setInterval(() => {
        const status = this.cronScheduler.getStatus();
        logger.debug('Service status:', status);
      }, 5 * 60 * 1000); // Every 5 minutes
      
    } catch (error) {
      logger.error('Failed to start application:', error);
      process.exit(1);
    }
  }
  
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.shuttingDown) return;
      
      this.shuttingDown = true;
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      try {
        // Stop cron scheduler
        this.cronScheduler.stop();
        
        // Disconnect from MongoDB
        await this.db.disconnect();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection:', reason);
      shutdown('unhandledRejection');
    });
  }
  
  async stop() {
    await this.cronScheduler.stop();
    await this.db.disconnect();
  }
}

// Start the application
if (require.main === module) {
  const app = new Application();
  app.start();
}

module.exports = Application;