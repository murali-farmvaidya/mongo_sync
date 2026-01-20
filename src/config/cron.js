const cron = require('node-cron');
const logger = require('../utils/logger');
const SyncJob = require('../jobs/sync.job');

class CronScheduler {
  constructor() {
    this.syncJob = new SyncJob();
    this.cronTask = null;
    this.schedule = process.env.SYNC_CRON_SCHEDULE || '0 * * * *'; // Every hour at minute 0
  }
  
  start() {
    if (this.cronTask) {
      logger.warn('Cron scheduler is already running');
      return;
    }
    
    logger.info(`Starting cron scheduler with schedule: ${this.schedule}`);
    
    this.cronTask = cron.schedule(this.schedule, async () => {
      logger.info('⏰ Cron triggered sync job');
      await this.syncJob.run();
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    // Run immediately on startup if configured
    if (process.env.RUN_ON_STARTUP === 'true') {
      logger.info('Running sync job on startup...');
      setTimeout(() => this.syncJob.run(), 5000); // Wait 5 seconds for app to fully start
    }
  }
  
  stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      logger.info('Cron scheduler stopped');
    }
  }
  
  async triggerManualSync() {
    logger.info('Manual sync triggered');
    return await this.syncJob.run();
  }
  
  getStatus() {
    const jobStatus = this.syncJob.getStatus();
    return {
      cronRunning: !!this.cronTask,
      schedule: this.schedule,
      jobStatus
    };
  }
}

module.exports = CronScheduler;