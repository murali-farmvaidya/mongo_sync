const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retry');
const { Session } = require('../config/db');

class SessionService {
  constructor(pipecatClient) {
    this.pipecatClient = pipecatClient;
  }
  
  // Helper to extract session ID from different possible fields
  extractSessionId(sessionData) {
    // Pipecat uses "sessionId" (with capital I)
    if (sessionData.sessionId) {
      return sessionData.sessionId;
    }
    
    // Also check other common field names
    const idFields = [
      'id',
      'session_id',
      'sessionID',
      '_id',
      'uid',
      'conversationId',
      'conversation_id',
      'callId',
      'call_id'
    ];
    
    for (const field of idFields) {
      if (sessionData[field]) {
        return sessionData[field];
      }
    }
    
    // If no ID field found, generate one from available data
    if (sessionData.createdAt) {
      return `session_${sessionData.createdAt}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Last resort: generate random ID
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  async syncSessionsForAgent(agentId, agentName) {
    try {
      logger.info(`Starting session sync for agent: ${agentName} (ID: ${agentId})`);
      
      const sessions = await retryWithBackoff(
        () => this.pipecatClient.getAllSessionsForAgent(agentName),
        `Fetch sessions for agent ${agentName}`
      );
      
      logger.info(`Fetched ${sessions.length} sessions for agent ${agentName}`);
      
      let created = 0;
      let updated = 0;
      let failed = 0;
      
      for (const sessionData of sessions) {
        try {
          const result = await this.upsertSession(agentId, agentName, sessionData);
          if (result.created) created++;
          if (result.updated) updated++;
        } catch (error) {
          logger.error(`Failed to upsert session ${sessionData.sessionId || 'unknown'}:`, error.message);
          failed++;
        }
      }
      
      logger.info(`Session sync for agent ${agentName} completed: ${created} created, ${updated} updated, ${failed} failed`);
      return { agentId, agentName, created, updated, failed, total: sessions.length };
      
    } catch (error) {
      logger.error(`Session sync failed for agent ${agentName}:`, error.message);
      throw error;
    }
  }
  
  async upsertSession(agentId, agentName, sessionData) {
    // Extract session ID - Pipecat uses "sessionId"
    const sessionId = this.extractSessionId(sessionData);
    
    if (!sessionId) {
      throw new Error('Session data missing sessionId');
    }
    
    const now = new Date();
    
    // Transform session data to match our schema
    const sessionDoc = {
      session_id: sessionId,
      agent_id: agentId,
      agent_name: agentName,
      status: sessionData.completionStatus || 'unknown',
      started_at: this.parseDate(sessionData.createdAt) || now,
      ended_at: this.parseDate(sessionData.endedAt) || null,
      metadata: {
        service_id: sessionData.serviceId,
        organization_id: sessionData.organizationId,
        deployment_id: sessionData.deploymentId,
        bot_start_seconds: sessionData.botStartSeconds,
        cold_start: sessionData.coldStart,
        completion_status: sessionData.completionStatus,
        created_at: sessionData.createdAt,
        updated_at: sessionData.updatedAt,
        ended_at: sessionData.endedAt,
        raw_data: sessionData // Keep full raw data
      },
      last_synced_at: now
    };
    
    try {
      const result = await Session.findOneAndUpdate(
        { session_id: sessionId },
        { $set: sessionDoc },
        { 
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      
      return {
        success: true,
        created: result.isNew,
        updated: !result.isNew,
        session_id: sessionId
      };
      
    } catch (error) {
      if (error.code === 11000) { // Duplicate key error
        logger.warn(`Duplicate session detected: ${sessionId}, retrying...`);
        // Retry without upsert
        await Session.updateOne(
          { session_id: sessionId },
          { $set: { ...sessionDoc, last_synced_at: now } }
        );
        return { success: true, created: false, updated: true, session_id: sessionId };
      }
      throw error;
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
  
  async getUnsyncedSessions(agentId) {
    try {
      // Get sessions that haven't been synced in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const sessions = await Session.find({
        agent_id: agentId,
        $or: [
          { last_synced_at: { $lt: oneHourAgo } },
          { last_synced_at: { $exists: false } }
        ]
      }, { session_id: 1 });
      
      return sessions.map(s => s.session_id);
    } catch (error) {
      logger.error(`Failed to fetch unsynced sessions for agent ${agentId}:`, error.message);
      return [];
    }
  }
}

module.exports = SessionService;