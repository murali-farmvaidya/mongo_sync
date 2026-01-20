const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retry');
const { Log } = require('../config/db');

class LogService {
  constructor(pipecatClient) {
    this.pipecatClient = pipecatClient;
  }
  
  // Helper to extract log ID from Pipecat log format
  extractLogId(logData, sessionId, index) {
    // Pipecat logs have 'log' and 'timestamp' fields
    // Create a unique ID from session + timestamp + hash of log message
    if (logData.timestamp && logData.log) {
      // Use sessionId + timestamp + first 20 chars of log message hash
      const logHash = require('crypto')
        .createHash('md5')
        .update(logData.log)
        .digest('hex')
        .substring(0, 8);
      
      // Clean timestamp for use in ID
      const cleanTimestamp = logData.timestamp
        .replace(/[:\.\-]/g, '')
        .replace('Z', '')
        .substring(0, 15);
      
      return `log_${sessionId}_${cleanTimestamp}_${logHash}`;
    }
    
    // Fallback: session + index + random
    return `log_${sessionId}_${index}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  // Helper to parse Pipecat log message into structured data
  parsePipecatLog(logMessage) {
    try {
      // Pipecat log format: "2026-01-12 04:30:22.239 | INFO     | __main__:run_bot:64 | ..."
      const parts = logMessage.split(' | ');
      
      if (parts.length >= 4) {
        const [timestampPart, levelPart, sourcePart, ...messageParts] = parts;
        const message = messageParts.join(' | ');
        
        // Extract level from levelPart (remove extra spaces)
        const level = levelPart.trim().toLowerCase();
        
        // Extract source info
        const source = sourcePart.trim();
        
        return {
          parsed_level: level,
          parsed_source: source,
          parsed_message: message,
          original_log: logMessage
        };
      }
      
      // If format doesn't match, return as-is
      return {
        parsed_level: 'info',
        parsed_source: 'unknown',
        parsed_message: logMessage,
        original_log: logMessage
      };
      
    } catch (error) {
      logger.warn('Failed to parse Pipecat log format:', error.message);
      return {
        parsed_level: 'info',
        parsed_source: 'unknown',
        parsed_message: logMessage,
        original_log: logMessage
      };
    }
  }
  
  async syncLogsForSession(agentId, agentName, sessionId, incremental = true) {
    try {
      logger.info(`Starting log sync for session: ${sessionId} (agent: ${agentName})`);
      
      let startTime = null;
      if (incremental) {
        // Get latest log timestamp to only fetch new logs
        const latestTimestamp = await this.getLatestLogTimestamp(sessionId);
        if (latestTimestamp) {
          startTime = latestTimestamp;
          logger.debug(`Incremental sync: fetching logs after ${latestTimestamp.toISOString()}`);
        }
      }
      
      // Note: Pipecat API might not support startTime parameter for logs
      // We'll fetch all logs and let our upsert logic handle duplicates
      const logs = await retryWithBackoff(
        () => this.pipecatClient.getAllLogsForSession(agentName, sessionId),
        `Fetch logs for session ${sessionId}`
      );
      
      logger.info(`Found ${logs.length} logs for session ${sessionId}`);
      
      // If we have a startTime, filter logs to only new ones
      let logsToProcess = logs;
      if (startTime) {
        logsToProcess = logs.filter(log => {
          const logTime = this.parseDate(log.timestamp);
          return logTime > startTime;
        });
        logger.info(`After filtering, ${logsToProcess.length} new logs to sync`);
      }
      
      let inserted = 0;
      let skipped = 0;
      let failed = 0;
      
      // Process logs in batches for better performance
      const batchSize = parseInt(process.env.SYNC_BATCH_SIZE) || 100;
      
      for (let i = 0; i < logsToProcess.length; i += batchSize) {
        const batch = logsToProcess.slice(i, i + batchSize);
        
        try {
          const result = await this.bulkInsertLogs(agentId, agentName, sessionId, batch, i);
          inserted += result.inserted;
          skipped += result.skipped;
        } catch (error) {
          logger.error(`Failed to insert log batch ${i}-${i + batchSize}:`, error.message);
          failed += batch.length;
        }
      }
      
      logger.info(`Log sync for session ${sessionId} completed: ${inserted} inserted, ${skipped} skipped, ${failed} failed`);
      return { sessionId, inserted, skipped, failed, total: logs.length, processed: logsToProcess.length };
      
    } catch (error) {
      logger.error(`Log sync failed for session ${sessionId}:`, error.message);
      throw error;
    }
  }
  
  async bulkInsertLogs(agentId, agentName, sessionId, logs, startIndex = 0) {
    if (!logs || logs.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    
    const operations = [];
    
    for (let i = 0; i < logs.length; i++) {
      const logData = logs[i];
      const logIndex = startIndex + i;
      const logId = this.extractLogId(logData, sessionId, logIndex);
      
      if (!logId) {
        logger.warn('Skipping log without ID:', logData);
        continue;
      }
      
      // Parse Pipecat log format
      const parsedLog = this.parsePipecatLog(logData.log || '');
      
      const logDoc = {
        log_id: logId,
        session_id: sessionId,
        agent_id: agentId,
        agent_name: agentName,
        timestamp: this.parseDate(logData.timestamp) || new Date(),
        level: parsedLog.parsed_level,
        message: parsedLog.parsed_message,
        data: {
          original_log: logData.log,
          timestamp: logData.timestamp,
          parsed_source: parsedLog.parsed_source,
          raw_data: logData // Keep full raw data
        },
        created_at: this.parseDate(logData.timestamp) || new Date()
      };
      
      operations.push({
        updateOne: {
          filter: { log_id: logId },
          update: { $setOnInsert: logDoc },
          upsert: true
        }
      });
    }
    
    if (operations.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    
    try {
      const result = await Log.bulkWrite(operations, { ordered: false });
      
      return {
        inserted: result.upsertedCount,
        skipped: logs.length - result.upsertedCount
      };
      
    } catch (error) {
      // Bulk write errors are logged but individual successes are preserved
      logger.warn(`Bulk insert partial failure: ${error.message}`);
      
      // Fallback to individual inserts for failed operations
      return await this.insertLogsIndividually(agentId, agentName, sessionId, logs, startIndex);
    }
  }
  
  // Helper to parse date from various formats
  parseDate(dateValue) {
    if (!dateValue) return null;
    
    try {
      // If it's already a Date object
      if (dateValue instanceof Date) {
        return dateValue;
      }
      
      // If it's a number (timestamp)
      if (typeof dateValue === 'number') {
        return new Date(dateValue);
      }
      
      // If it's a string
      if (typeof dateValue === 'string') {
        // Try parsing as ISO string
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          return date;
        }
        
        // Try parsing as Unix timestamp (in seconds or milliseconds)
        const timestamp = parseInt(dateValue);
        if (!isNaN(timestamp)) {
          // Check if it's in seconds (less than 1e12) or milliseconds
          return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
        }
      }
      
      return null;
    } catch (error) {
      logger.warn(`Failed to parse date: ${dateValue}`, error.message);
      return null;
    }
  }
  
  async insertLogsIndividually(agentId, agentName, sessionId, logs, startIndex = 0) {
    let inserted = 0;
    let skipped = 0;
    
    for (let i = 0; i < logs.length; i++) {
      const logData = logs[i];
      const logIndex = startIndex + i;
      
      try {
        const result = await this.insertLog(agentId, agentName, sessionId, logData, logIndex);
        if (result.inserted) inserted++;
        if (result.skipped) skipped++;
      } catch (error) {
        logger.error(`Failed to insert individual log:`, error.message);
        skipped++;
      }
    }
    
    return { inserted, skipped };
  }
  
  async insertLog(agentId, agentName, sessionId, logData, index) {
    const logId = this.extractLogId(logData, sessionId, index);
    
    if (!logId) {
      return { inserted: false, skipped: true, error: 'Missing log ID' };
    }
    
    // Parse Pipecat log format
    const parsedLog = this.parsePipecatLog(logData.log || '');
    
    const logDoc = {
      log_id: logId,
      session_id: sessionId,
      agent_id: agentId,
      agent_name: agentName,
      timestamp: this.parseDate(logData.timestamp) || new Date(),
      level: parsedLog.parsed_level,
      message: parsedLog.parsed_message,
      data: {
        original_log: logData.log,
        timestamp: logData.timestamp,
        parsed_source: parsedLog.parsed_source,
        raw_data: logData
      },
      created_at: this.parseDate(logData.timestamp) || new Date()
    };
    
    try {
      const result = await Log.updateOne(
        { log_id: logId },
        { $setOnInsert: logDoc },
        { upsert: true }
      );
      
      return {
        inserted: result.upsertedCount > 0,
        skipped: result.upsertedCount === 0,
        log_id: logId
      };
      
    } catch (error) {
      if (error.code === 11000) { // Duplicate key
        return { inserted: false, skipped: true, log_id: logId };
      }
      throw error;
    }
  }
  
  async getLatestLogTimestamp(sessionId) {
    try {
      const latestLog = await Log.findOne(
        { session_id: sessionId },
        { timestamp: 1 }
      ).sort({ timestamp: -1 }).limit(1);
      
      return latestLog ? latestLog.timestamp : null;
    } catch (error) {
      logger.error(`Failed to fetch latest log timestamp for session ${sessionId}:`, error.message);
      return null;
    }
  }
}

module.exports = LogService;