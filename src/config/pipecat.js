const axios = require('axios');
const logger = require('../utils/logger');

class PipecatClient {
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

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        if (process.env.LOG_LEVEL === 'debug') {
          logger.debug('Pipecat API Response:', {
            url: response.config.url,
            status: response.status
          });
        }
        return response;
      },
      (error) => {
        logger.error('Pipecat API Error:', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  // Get agents (services)
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

  // Get sessions for an agent (using agent NAME)
  async getAgentSessions(agentName, page = 1, limit = 100) {
    try {
      const response = await this.client.get(`/agents/${encodeURIComponent(agentName)}/sessions`, {
        params: {
          page,
          limit,
          offset: (page - 1) * limit
        }
      });

      // Log raw response for debugging
      if (process.env.LOG_LEVEL === 'debug') {
        logger.debug(`Raw sessions response for ${agentName}:`, {
          status: response.status,
          dataKeys: Object.keys(response.data),
          sampleSession: response.data.sessions?.[0] || response.data?.[0]
        });
      }

      // Sessions might be in data.sessions or directly in response.data
      const sessions = response.data.sessions || response.data || [];

      return {
        data: sessions,
        page,
        limit,
        total: response.data.total || sessions.length,
        hasMore: sessions.length === limit
      };

    } catch (error) {
      logger.error(`Failed to fetch sessions for agent ${agentName}:`, error.message);
      throw error;
    }
  }

  // Get logs for an agent session (using agent NAME and sessionId)
  // query param allows server-side filtering (e.g., "Generating TTS" or "Generating chat")
  async getAgentLogs(agentName, sessionId, page = 1, limit = 100, query = null) {
    try {
      const params = {
        limit
      };

      // Use offset instead of page for Pipecat API
      if (page > 1) {
        params.offset = (page - 1) * limit;
      }

      if (sessionId) {
        params.session_id = sessionId;
      }

      if (query) {
        params.query = query;
      }

      const response = await this.client.get(`/agents/${encodeURIComponent(agentName)}/logs`, {
        params
      });

      // Logs are in response.data.logs, total in response.data.total
      const logs = response.data.logs || response.data || [];
      const totalObj = response.data.total;
      const total = typeof totalObj === 'object' ? totalObj.value : (totalObj || logs.length);

      return {
        data: logs,
        page,
        limit,
        total,
        hasMore: logs.length === limit
      };

    } catch (error) {
      logger.error(`Failed to fetch logs for agent ${agentName}, session ${sessionId}:`, error.message);
      throw error;
    }
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

      logger.info(`Fetched ${allAgents.length} agents from Pipecat Cloud`);
      return allAgents;
    } catch (error) {
      logger.error('Failed to fetch all agents:', error.message);
      throw error;
    }
  }

  async getAllSessionsForAgent(agentName) {
    let allSessions = [];
    let page = 1;
    const limit = 100;

    try {
      while (true) {
        const response = await this.getAgentSessions(agentName, page, limit);
        const sessions = response.data || [];

        if (!sessions || sessions.length === 0) break;

        allSessions = allSessions.concat(sessions);

        logger.debug(`Fetched page ${page}: ${sessions.length} sessions for ${agentName}`);

        if (!response.hasMore || sessions.length < limit) break;

        page++;
        await this.delay(this.rateLimitDelay);
      }

      logger.info(`Fetched ${allSessions.length} sessions for agent ${agentName}`);
      return allSessions;
    } catch (error) {
      logger.error(`Failed to fetch all sessions for agent ${agentName}:`, error.message);
      throw error;
    }
  }

  // Modified to support optional callback for incremental processing
  async getAllLogsForSession(agentName, sessionId, onBatch = null) {
    let allLogs = [];
    let page = 1;
    const limit = 100;
    let totalProcessed = 0;

    try {
      while (true) {
        const response = await this.getAgentLogs(agentName, sessionId, page, limit);
        const logs = response.data || [];

        if (!logs || logs.length === 0) break;

        if (onBatch) {
          // Process batch immediately
          await onBatch(logs, (page - 1) * limit);
          // Do NOT accumulate if streaming to save memory
        } else {
          allLogs = allLogs.concat(logs);
        }

        totalProcessed += logs.length;

        logger.debug(`Fetched page ${page}: ${logs.length} logs for session ${sessionId}`);

        if (!response.hasMore || logs.length < limit) break;

        page++;
        await this.delay(this.rateLimitDelay);
      }

      logger.info(`Fetched total ${totalProcessed} logs for session ${sessionId}`);
      return onBatch ? [] : allLogs; // Return empty if processed via callback
    } catch (error) {
      logger.error(`Failed to fetch all logs for session ${sessionId}:`, error.message);
      throw error;
    }
  }

  // Fetch ONLY conversation logs (TTS and chat) using server-side query filtering
  // This is MUCH faster than fetching all logs and filtering client-side
  async getConversationLogs(agentName, onBatch = null) {
    const limit = 100;
    let totalTTS = 0;
    let totalChat = 0;

    try {
      // Fetch TTS logs (assistant responses)
      logger.info(`Fetching TTS logs for agent ${agentName}...`);
      let page = 1;
      while (true) {
        const response = await this.getAgentLogs(agentName, null, page, limit, 'Generating TTS');
        const logs = response.data || [];

        if (!logs || logs.length === 0) break;

        totalTTS += logs.length;

        if (onBatch) {
          await onBatch(logs, 'tts');
        }

        logger.debug(`Fetched TTS page ${page}: ${logs.length} logs`);

        if (!response.hasMore || logs.length < limit) break;
        page++;
        await this.delay(this.rateLimitDelay);
      }

      // Fetch Chat context logs (user questions)
      logger.info(`Fetching Chat context logs for agent ${agentName}...`);
      page = 1;
      while (true) {
        const response = await this.getAgentLogs(agentName, null, page, limit, 'Generating chat');
        const logs = response.data || [];

        if (!logs || logs.length === 0) break;

        totalChat += logs.length;

        if (onBatch) {
          await onBatch(logs, 'chat');
        }

        logger.debug(`Fetched Chat page ${page}: ${logs.length} logs`);

        if (!response.hasMore || logs.length < limit) break;
        page++;
        await this.delay(this.rateLimitDelay);
      }

      logger.info(`Fetched ${totalTTS} TTS logs and ${totalChat} Chat logs for agent ${agentName}`);
      return { tts: totalTTS, chat: totalChat };

    } catch (error) {
      logger.error(`Failed to fetch conversation logs for agent ${agentName}:`, error.message);
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async testConnection() {
    try {
      const response = await this.client.get('/agents', { params: { limit: 1 } });
      const agents = response.data.services || response.data || [];

      return {
        success: true,
        status: response.status,
        agentCount: agents.length,
        sampleAgent: agents.length > 0 ? agents[0] : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        status: error.response?.status
      };
    }
  }
}

module.exports = PipecatClient;