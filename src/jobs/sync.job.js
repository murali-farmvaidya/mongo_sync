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
    if (this.isRunning) {
      logger.warn('Sync job is already running. Skipping...');
      return { skipped: true, reason: 'Job already running' };
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('🚀 Starting Pipecat to MongoDB sync job');
      
      // Reset stats
      this.stats = {
        agents: { created: 0, updated: 0, failed: 0 },
        sessions: { created: 0, updated: 0, failed: 0 },
        logs: { inserted: 0, skipped: 0, failed: 0 }
      };
      
      // Step 1: Sync all agents
      const agentResult = await this.agentService.syncAgents();
      this.stats.agents = agentResult;
      
      // Step 2: Get all agents and sync their sessions
      const agents = await this.agentService.getAllAgentNames();
      logger.info(`Found ${agents.length} agents to sync sessions for`);
      
      for (const agent of agents) {
        const agentId = agent.id;
        const agentName = agent.name;
        
        try {
          const sessionResult = await this.sessionService.syncSessionsForAgent(agentId, agentName);
          this.stats.sessions.created += sessionResult.created;
          this.stats.sessions.updated += sessionResult.updated;
          this.stats.sessions.failed += sessionResult.failed;
          
          // Step 3: Get ALL sessions for this agent and sync logs for each
          // Instead of getting "unsynced" sessions, get all sessions from MongoDB
          const allSessions = await this.getAllSessionsForAgent(agentId);
          logger.info(`Found ${allSessions.length} sessions to sync logs for agent ${agentName}`);
          
          for (const session of allSessions) {
            try {
              const logResult = await this.logService.syncLogsForSession(agentId, agentName, session.session_id);
              this.stats.logs.inserted += logResult.inserted;
              this.stats.logs.skipped += logResult.skipped;
              this.stats.logs.failed += logResult.failed;
            } catch (error) {
              logger.error(`Failed to sync logs for session ${session.session_id}:`, error.message);
              this.stats.logs.failed++;
            }
          }
          
        } catch (error) {
          logger.error(`Failed to sync sessions for agent ${agentName}:`, error.message);
          this.stats.sessions.failed++;
        }
      }
      
      const duration = Date.now() - startTime;
      this.lastRun = new Date();
      
      logger.info('✅ Sync job completed successfully', {
        duration: `${duration}ms`,
        stats: this.stats
      });
      
      return {
        success: true,
        duration,
        stats: this.stats,
        timestamp: this.lastRun
      };
      
    } catch (error) {
      logger.error('❌ Sync job failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        stats: this.stats
      };
      
    } finally {
      this.isRunning = false;
    }
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