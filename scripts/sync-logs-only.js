#!/usr/bin/env node

require('dotenv').config({ path: '.env' });
const logger = require('../src/utils/logger');
const { Database, createIndexes, Session } = require('../src/config/db');
const PipecatClient = require('../src/config/pipecat');
const LogService = require('../src/services/log.service');

async function syncLogsOnly() {
  logger.info('🔄 Starting logs-only sync...');
  
  const db = new Database();
  const pipecatClient = new PipecatClient();
  const logService = new LogService(pipecatClient);
  
  try {
    // Connect to database
    await db.connect();
    await createIndexes();
    
    // Get all sessions from MongoDB
    const sessions = await Session.find({}, { session_id: 1, agent_id: 1, agent_name: 1 });
    logger.info(`Found ${sessions.length} sessions to sync logs for`);
    
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let completed = 0;
    
    // Process sessions in batches to avoid memory issues
    const batchSize = 10;
    
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      
      // Process batch in parallel
      const promises = batch.map(async (session) => {
        try {
          const result = await logService.syncLogsForSession(
            session.agent_id,
            session.agent_name,
            session.session_id,
            true // incremental sync
          );
          
          completed++;
          logger.info(`[${completed}/${sessions.length}] Session ${session.session_id}: ${result.inserted} inserted, ${result.skipped} skipped`);
          
          return result;
        } catch (error) {
          logger.error(`Failed to sync logs for session ${session.session_id}:`, error.message);
          return { inserted: 0, skipped: 0, failed: 1 };
        }
      });
      
      const results = await Promise.all(promises);
      
      // Update totals
      results.forEach(result => {
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalFailed += result.failed || 0;
      });
      
      // Log progress
      const progress = Math.round((completed / sessions.length) * 100);
      logger.info(`Progress: ${progress}% (${completed}/${sessions.length} sessions)`);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < sessions.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Final summary
    logger.info('✅ Logs sync completed!', {
      totalSessions: sessions.length,
      totalInserted,
      totalSkipped,
      totalFailed
    });
    
    console.log('\n=== LOGS SYNC SUMMARY ===');
    console.log(`Sessions processed: ${sessions.length}`);
    console.log(`Logs inserted: ${totalInserted}`);
    console.log(`Logs skipped (duplicates): ${totalSkipped}`);
    console.log(`Logs failed: ${totalFailed}`);
    console.log('=========================\n');
    
  } catch (error) {
    logger.error('❌ Logs sync failed:', error.message);
    console.error('\n=== SYNC FAILED ===');
    console.error(`Error: ${error.message}`);
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
Usage: node scripts/sync-logs-only.js [options]

Options:
  --help, -h     Show this help message
  --debug        Enable debug logging
  --all          Sync all logs (not incremental)

Example:
  node scripts/sync-logs-only.js
  node scripts/sync-logs-only.js --debug
  `);
  process.exit(0);
}

syncLogsOnly();