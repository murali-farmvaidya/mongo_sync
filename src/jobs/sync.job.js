const logger = require('../utils/logger');
const PipecatClient = require('../config/pipecat');
const AgentService = require('../services/agent.service');
const SessionService = require('../services/session.service');
const LogService = require('../services/log.service');

class SyncJob {
  constructor() {
    this.pipecatClient = new PipecatClient();
    this.agentService = new AgentService(this.pipecatClient);
    this.sessionService = new SessionService(this.pipecatClient);
    this.logService = new LogService(this.pipecatClient);
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      agents: { created: 0, updated: 0, failed: 0 },
      sessions: { created: 0, updated: 0, failed: 0 },
      logs: { inserted: 0, skipped: 0, failed: 0 }
    };
  }

  async run() {
    logger.info('Legacy SyncJob is DISABLED. Please use valid "npm run sync" (sync-realtime.js) instead.');
    return { success: true, status: 'disabled' };
  }

  // Helper to get all sessions for an agent from MongoDB
  async getAllSessionsForAgent(agentId) {
    try {
      const { Session } = require('../config/db');
      const sessions = await Session.find(
        { agent_id: agentId },
        { session_id: 1, agent_name: 1 }
      );
      return sessions;
    } catch (error) {
      logger.error(`Failed to fetch sessions for agent ${agentId}:`, error.message);
      return [];
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      stats: this.stats
    };
  }
}

module.exports = SyncJob;