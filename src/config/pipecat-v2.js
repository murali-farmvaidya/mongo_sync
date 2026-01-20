const axios = require('axios');
const logger = require('../utils/logger');

class PipecatClientV2 {
  constructor() {
    this.apiKey = process.env.PIPECAT_API_KEY;
    this.baseURL = process.env.PIPECAT_BASE_URL || 'https://api.pipecat.daily.co/v1';
    this.rateLimitDelay = parseInt(process.env.PIPECAT_RATE_LIMIT_DELAY_MS) || 100;
    
    if (!this.apiKey) {
      throw new Error('PIPECAT_API_KEY environment variable is required');
    }
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Pipecat-MongoDB-Sync/1.0'
      }
    });
  }
  
  // Get services (from /agents endpoint)
  async getAgents(page = 1, limit = 100) {
    try {
      const response = await this.client.get('/agents', {
        params: { page, limit }
      });
      
      // The /agents endpoint returns services array
      const agents = response.data.services || response.data || [];
      
      return {
        data: agents,
        page,
        limit,
        total: response.data.total || agents.length,
        hasMore: agents.length === limit
      };
      
    } catch (error) {
      logger.error(`Failed to fetch agents page ${page}:`, error.message);
      throw error;
    }
  }
  
  // Try to get sessions using service ID
  async getServiceSessions(serviceId, page = 1, limit = 100) {
    const patterns = [
      `/agents/${serviceId}/sessions`,
      `/services/${serviceId}/sessions`,
      `/sessions?serviceId=${serviceId}`,
      `/sessions?agentId=${serviceId}`
    ];
    
    for (const pattern of patterns) {
      try {
        const response = await this.client.get(pattern, {
          params: { page, limit }
        });
        
        const sessions = response.data.sessions || response.data || [];
        
        logger.debug(`Found ${sessions.length} sessions using pattern: ${pattern}`);
        
        return {
          data: sessions,
          page,
          limit,
          total: response.data.total || sessions.length,
          hasMore: sessions.length === limit,
          pattern: pattern // Remember which pattern worked
        };
      } catch (error) {
        logger.debug(`Pattern ${pattern} failed: ${error.response?.status || error.message}`);
        continue;
      }
    }
    
    throw new Error(`No working session endpoint found for service ${serviceId}`);
  }
  
  // Try to get logs using service ID and session ID
  async getServiceLogs(serviceId, sessionId = null, page = 1, limit = 100) {
    const basePatterns = sessionId ? [
      `/agents/${serviceId}/logs?sessionId=${sessionId}`,
      `/services/${serviceId}/logs?sessionId=${sessionId}`,
      `/logs?sessionId=${sessionId}&serviceId=${serviceId}`,
      `/logs?sessionId=${sessionId}&agentId=${serviceId}`
    ] : [
      `/agents/${serviceId}/logs`,
      `/services/${serviceId}/logs`,
      `/logs?serviceId=${serviceId}`,
      `/logs?agentId=${serviceId}`
    ];
    
    for (const pattern of basePatterns) {
      try {
        // Extract path and params
        const [path, query] = pattern.split('?');
        const params = { page, limit };
        
        if (query) {
          const queryParams = new URLSearchParams(query);
          for (const [key, value] of queryParams) {
            params[key] = value;
          }
        }
        
        const response = await this.client.get(path, { params });
        
        const logs = response.data.logs || response.data || [];
        
        logger.debug(`Found ${logs.length} logs using pattern: ${pattern}`);
        
        return {
          data: logs,
          page,
          limit,
          total: response.data.total || logs.length,
          hasMore: logs.length === limit,
          pattern: pattern
        };
      } catch (error) {
        logger.debug(`Pattern ${pattern} failed: ${error.response?.status || error.message}`);
        continue;
      }
    }
    
    const errorMsg = sessionId 
      ? `No working log endpoint found for service ${serviceId}, session ${sessionId}`
      : `No working log endpoint found for service ${serviceId}`;
    
    throw new Error(errorMsg);
  }
  
  async getAllAgents() {
    let allAgents = [];
    let page = 1;
    const limit = 100;
    
    try {
      while (true) {
        const response = await this.getAgents(page, limit);
        const agents = response.data || [];
        
        if (!agents || agents.length === 0) break;
        
        allAgents = allAgents.concat(agents);
        
        logger.debug(`Fetched page ${page}: ${agents.length} agents (total: ${allAgents.length})`);
        
        if (!response.hasMore || agents.length < limit) break;
        
        page++;
        await this.delay(this.rateLimitDelay);
      }
      
      logger.info(`Fetched ${allAgents.length} agents (services) from Pipecat Cloud`);
      return allAgents;
    } catch (error) {
      logger.error('Failed to fetch all agents:', error.message);
      throw error;
    }
  }
  
  async getAllSessionsForService(serviceId) {
    let allSessions = [];
    let page = 1;
    const limit = 100;
    
    try {
      while (true) {
        const response = await this.getServiceSessions(serviceId, page, limit);
        const sessions = response.data || [];
        
        if (!sessions || sessions.length === 0) break;
        
        allSessions = allSessions.concat(sessions);
        
        if (!response.hasMore || sessions.length < limit) break;
        
        page++;
        await this.delay(this.rateLimitDelay);
      }
      
      logger.debug(`Fetched ${allSessions.length} sessions for service ${serviceId}`);
      return allSessions;
    } catch (error) {
      logger.error(`Failed to fetch all sessions for service ${serviceId}:`, error.message);
      throw error;
    }
  }
  
  async getAllLogsForSession(serviceId, sessionId) {
    let allLogs = [];
    let page = 1;
    const limit = 100;
    
    try {
      while (true) {
        const response = await this.getServiceLogs(serviceId, sessionId, page, limit);
        const logs = response.data || [];
        
        if (!logs || logs.length === 0) break;
        
        allLogs = allLogs.concat(logs);
        
        if (!response.hasMore || logs.length < limit) break;
        
        page++;
        await this.delay(this.rateLimitDelay);
      }
      
      logger.debug(`Fetched ${allLogs.length} logs for session ${sessionId}`);
      return allLogs;
    } catch (error) {
      logger.error(`Failed to fetch all logs for session ${sessionId}:`, error.message);
      throw error;
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = PipecatClientV2;