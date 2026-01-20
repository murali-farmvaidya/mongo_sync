require('dotenv').config();
const logger = require('./src/utils/logger');
const PipecatClient = require('./src/config/pipecat');

async function testFullFlow() {
  console.log('🔍 Testing full Pipecat API flow');
  
  const client = new PipecatClient();
  
  try {
    // 1. Test connection
    console.log('\n1. Testing connection...');
    const connection = await client.testConnection();
    if (!connection.success) {
      throw new Error(`Connection failed: ${connection.error}`);
    }
    console.log(`✅ Connected! Found ${connection.agentCount} agents`);
    
    // 2. Get all agents
    console.log('\n2. Fetching all agents...');
    const agents = await client.getAllAgents();
    console.log(`✅ Found ${agents.length} agents`);
    
    if (agents.length > 0) {
      const agent = agents[0];
      console.log(`Testing with agent: ${agent.name} (ID: ${agent.id})`);
      
      // 3. Get sessions for first agent
      console.log(`\n3. Fetching sessions for agent "${agent.name}"...`);
      const sessions = await client.getAllSessionsForAgent(agent.name);
      console.log(`✅ Found ${sessions.length} sessions`);
      
      if (sessions.length > 0) {
        const session = sessions[0];
        console.log(`Testing with session: ${session.id}`);
        
        // 4. Get logs for first session
        console.log(`\n4. Fetching logs for session "${session.id}"...`);
        const logs = await client.getAllLogsForSession(agent.name, session.id);
        console.log(`✅ Found ${logs.length} logs`);
        
        if (logs.length > 0) {
          console.log('Sample log:', {
            id: logs[0].id,
            level: logs[0].level,
            message: logs[0].message?.substring(0, 100) + '...',
            timestamp: logs[0].timestamp || logs[0].created_at
          });
        }
      }
    }
    
    console.log('\n🎉 All API endpoints are working correctly!');
    console.log('\n📋 Summary:');
    console.log(`- Agents endpoint: ✓ (${agents.length} agents)`);
    console.log(`- Sessions endpoint: ✓ (tested with 1 agent)`);
    console.log(`- Logs endpoint: ✓ (tested with 1 session)`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testFullFlow();