#!/usr/bin/env node

require('dotenv').config({ path: '.env' });
const logger = require('../src/utils/logger');
const { Database, createIndexes } = require('../src/config/db');
const SyncJob = require('../src/jobs/sync.job');

async function runManualSync() {
  logger.info('🔄 Starting manual sync...');
  
  const db = new Database();
  const syncJob = new SyncJob();
  
  try {
    // Connect to database
    await db.connect();
    await createIndexes();
    
    // Run sync job
    const result = await syncJob.run();
    
    if (result.success) {
      logger.info('✅ Manual sync completed successfully');
      console.log('\n=== SYNC SUMMARY ===');
      console.log(`Duration: ${result.duration}ms`);
      console.log(`Agents: ${result.stats.agents.created} created, ${result.stats.agents.updated} updated, ${result.stats.agents.failed} failed`);
      console.log(`Sessions: ${result.stats.sessions.created} created, ${result.stats.sessions.updated} updated, ${result.stats.sessions.failed} failed`);
      console.log(`Logs: ${result.stats.logs.inserted} inserted, ${result.stats.logs.skipped} skipped, ${result.stats.logs.failed} failed`);
      console.log('===================\n');
    } else {
      logger.error('❌ Manual sync failed');
      console.error('\n=== SYNC FAILED ===');
      console.error(`Error: ${result.error}`);
      console.error('===================\n');
      process.exit(1);
    }
    
  } catch (error) {
    logger.error('Manual sync failed:', error);
    console.error('\n=== FATAL ERROR ===');
    console.error(error.message);
    console.error('===================\n');
    process.exit(1);
  } finally {
    await db.disconnect();
    process.exit(0);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run sync [options]

Options:
  --help, -h     Show this help message
  --debug        Enable debug logging

Example:
  npm run sync
  node scripts/manual-sync.js --debug
  `);
  process.exit(0);
}

if (args.includes('--debug')) {
  process.env.LOG_LEVEL = 'debug';
}

runManualSync();