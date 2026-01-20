const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retry');
const { Agent } = require('../config/db');

class AgentService {
  constructor(pipecatClient) {
    this.pipecatClient = pipecatClient;
  }
  
  async syncAgents() {
    try {
      logger.info('Starting agent sync...');
      
      const agents = await retryWithBackoff(
        () => this.pipecatClient.getAllAgents(),
        'Fetch agents from Pipecat'
      );
      
      let created = 0;
      let updated = 0;
      let failed = 0;
      
      for (const agentData of agents) {
        try {
          const result = await this.upsertAgent(agentData);
          if (result.created) created++;
          if (result.updated) updated++;
        } catch (error) {
          logger.error(`Failed to upsert agent ${agentData.name}:`, error.message);
          failed++;
        }
      }
      
      logger.info(`Agent sync completed: ${created} created, ${updated} updated, ${failed} failed`);
      return { created, updated, failed, total: agents.length };
      
    } catch (error) {
      logger.error('Agent sync failed:', error.message);
      throw error;
    }
  }
  
  async upsertAgent(agentData) {
    const agentId = agentData.id;
    const agentName = agentData.name;
    
    if (!agentId || !agentName) {
      throw new Error('Agent data missing ID or name');
    }
    
    const now = new Date();
    
    // Store both ID and name - we need name for API calls
    const agentDoc = {
      agent_id: agentId,
      agent_name: agentName, // Store name separately for API calls
      name: agentName,
      description: agentData.description || `Pipecat Agent: ${agentName}`,
      config: {
        region: agentData.region,
        deployment_id: agentData.activeDeploymentId,
        organization_id: agentData.organizationId
      },
      metadata: {
        region: agentData.region,
        activeDeploymentId: agentData.activeDeploymentId,
        organizationId: agentData.organizationId,
        created_at: agentData.createdAt,
        updated_at: agentData.updatedAt,
        deleted_at: agentData.deletedAt
      },
      created_at: agentData.createdAt ? new Date(agentData.createdAt) : now,
      updated_at: agentData.updatedAt ? new Date(agentData.updatedAt) : now,
      last_synced_at: now
    };
    
    try {
      const result = await Agent.findOneAndUpdate(
        { agent_id: agentId },
        { $set: agentDoc },
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
        agent_id: agentId,
        agent_name: agentName
      };
      
    } catch (error) {
      if (error.code === 11000) { // Duplicate key error
        logger.warn(`Duplicate agent detected: ${agentName}, retrying...`);
        // Retry without upsert
        await Agent.updateOne(
          { agent_id: agentId },
          { $set: { ...agentDoc, last_synced_at: now } }
        );
        return { success: true, created: false, updated: true, agent_id: agentId, agent_name: agentName };
      }
      throw error;
    }
  }
  
  async getAllAgentNames() {
    try {
      const agents = await Agent.find({}, { agent_id: 1, agent_name: 1, name: 1 });
      return agents.map(a => ({ 
        id: a.agent_id, 
        name: a.agent_name || a.name,
        stored_name: a.name
      }));
    } catch (error) {
      logger.error('Failed to fetch agent names:', error.message);
      throw error;
    }
  }
}

module.exports = AgentService;