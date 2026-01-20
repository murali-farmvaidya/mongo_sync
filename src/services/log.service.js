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

      let inserted = 0;
      let skipped = 0;
      let failed = 0;
      let totalFetched = 0;

      // Define batch processor
      const processBatch = async (batchLogs, offset) => {
        totalFetched += batchLogs.length;

        // Filter by time if needed
        let logsToProcess = batchLogs;
        if (startTime) {
          logsToProcess = batchLogs.filter(log => {
            const logTime = this.parseDate(log.timestamp);
            return logTime > startTime;
          });
        }

        if (logsToProcess.length === 0) {
          skipped += batchLogs.length;
          return;
        }

        try {
          // Pass absolute index if possible, or just offset
          const result = await this.bulkInsertLogs(agentId, agentName, sessionId, logsToProcess, offset);
          inserted += result.inserted;
          // Skipped from bulkInsert (filtering criteria) + skipped from time filtering
          skipped += result.skipped + (batchLogs.length - logsToProcess.length);
        } catch (error) {
          logger.error(`Failed to insert incremental batch:`, error.message);
          failed += logsToProcess.length;
        }
      };

      // Fetch and process in streams
      await this.pipecatClient.getAllLogsForSession(agentName, sessionId, processBatch);

      logger.info(`Log sync for session ${sessionId} completed: ${inserted} inserted, ${skipped} skipped, ${failed} failed`);
      return { sessionId, inserted, skipped, failed, total: totalFetched, processed: totalFetched };

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
    let skippedCount = 0;

    for (let i = 0; i < logs.length; i++) {
      const logData = logs[i];
      const logIndex = startIndex + i;

      // Filter and transform Logic
      const originalMessage = logData.log || '';

      let transformType = null;
      let cleanMessage = '';
      let cleanData = null;

      // 1. Check for User Question (Context Log)
      // Formats: "Generating chat from universal context [...]" OR "Generating chat from LLM-specific context [...]"
      if (originalMessage.includes('Generating chat from') && originalMessage.includes('context [')) {
        try {
          // Find 'role': 'user' followed by 'content': '...'
          const userContentMatch = originalMessage.match(/'role':\s*'user',\s*'content':\s*'([^']*(?:''[^']*)*)'/);

          if (userContentMatch && userContentMatch[1]) {
            transformType = 'question';
            cleanMessage = userContentMatch[1].replace(/''/g, "'"); // unescape doubled quotes
            cleanData = { role: 'user', content: cleanMessage };
          }
        } catch (e) {
          // Silently ignore parse errors
        }
      }

      // 2. Check for Assistant Response (TTS Log)
      // Formats: "Generating TTS [text]" OR "Generating TTS: [text]" OR "Generating TTS: [ text]"
      else if (originalMessage.includes('Generating TTS')) {
        // Match both "Generating TTS [" and "Generating TTS: [" variants
        const match = originalMessage.match(/Generating TTS:?\s*\[(.+)\]/);
        if (match && match[1]) {
          transformType = 'response';
          cleanMessage = match[1].trim();
          cleanData = { role: 'assistant', content: cleanMessage };
        }
      }

      // If it doesn't match our filters, skip it
      if (!transformType) {
        skippedCount++;
        continue;
      }

      const logId = this.extractLogId(logData, sessionId, logIndex);

      if (!logId) {
        continue;
      }

      const logDoc = {
        log_id: logId,
        session_id: sessionId,
        agent_id: agentId,
        agent_name: agentName,
        timestamp: this.parseDate(logData.timestamp) || new Date(),
        level: transformType === 'question' ? 'INFO' : 'INFO',
        message: cleanMessage,
        data: {
          type: transformType,
          ...cleanData
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

    // DEBUG: Log batch results
    if (operations.length > 0) {
      logger.info(`[DEBUG] Batch (start ${startIndex}): Inserted ${operations.length}, Skipped ${skippedCount}`);
    } else if (skippedCount > 0) {
      // Only log 1 in 10 skipped batches to avoid spam, OR if it's the first one
      if (startIndex === 0 || Math.random() < 0.1) {
        logger.info(`[DEBUG] Batch (start ${startIndex}): Skipped ALL ${skippedCount}`);
      }
    }

    if (operations.length === 0) {
      return { inserted: 0, skipped: logs.length };
    }

    try {
      const result = await Log.bulkWrite(operations, { ordered: false });

      return {
        inserted: result.upsertedCount,
        skipped: skippedCount + (operations.length - result.upsertedCount)
      };

    } catch (error) {
      logger.warn(`Bulk insert partial failure: ${error.message}`);
      return { inserted: 0, skipped: logs.length }; // Simplification for error handling
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