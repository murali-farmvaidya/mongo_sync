require('dotenv').config();
const logger = require('./src/utils/logger');
const { Database, createIndexes, Agent, Session, Log } = require('./src/config/db');
const PipecatClient = require('./src/config/pipecat');

async function testCompleteSync() {
  console.log('🚀 Testing complete sync flow');
  
  const db = new Database();
  const client = new PipecatClient();
  
  try {
    // Connect to database
    await db.connect();
    await createIndexes();
    
    // 1. Test agents (services)
    console.log('\n1. Testing agents sync...');
    const agents = await client.getAllAgents();
    console.log(`✅ Found ${agents.length} agents`);
    
    // Store first agent for testing
    const testAgent = agents[0];
    console.log(`Test agent: ${testAgent.name} (${testAgent.id})`);
    
    // 2. Test sessions for this agent
    console.log(`\n2. Testing sessions for agent "${testAgent.name}"...`);
    const sessions = await client.getAllSessionsForAgent(testAgent.name);
    console.log(`✅ Found ${sessions.length} sessions`);
    
    if (sessions.length > 0) {
      const testSession = sessions[0];
      console.log(`Test session: ${testSession.sessionId}`);
      console.log('Session data:', {
        sessionId: testSession.sessionId,
        createdAt: testSession.createdAt,
        endedAt: testSession.endedAt,
        completionStatus: testSession.completionStatus
      });
      
      // 3. Test logs for this session
      console.log(`\n3. Testing logs for session "${testSession.sessionId}"...`);
      const logs = await client.getAllLogsForSession(testAgent.name, testSession.sessionId);
      console.log(`✅ Found ${logs.length} logs`);
      
      if (logs.length > 0) {
        console.log('Sample log:', {
          timestamp: logs[0].timestamp,
          log: logs[0].log?.substring(0, 100) + '...'
        });
      }
      
      // 4. Test database operations
      console.log('\n4. Testing database operations...');
      
      // Insert test agent
      const agentDoc = {
        agent_id: testAgent.id,
        agent_name: testAgent.name,
        name: testAgent.name,
        config: {
          region: testAgent.region,
          deployment_id: testAgent.activeDeploymentId
        },
        created_at: new Date(testAgent.createdAt),
        updated_at: new Date(testAgent.updatedAt),
        last_synced_at: new Date()
      };
      
      await Agent.findOneAndUpdate(
        { agent_id: testAgent.id },
        { $set: agentDoc },
        { upsert: true }
      );
      console.log('✅ Agent stored in MongoDB');
      
      // Insert test session
      const sessionDoc = {
        session_id: testSession.sessionId,
        agent_id: testAgent.id,
        agent_name: testAgent.name,
        status: testSession.completionStatus || 'unknown',
        started_at: new Date(testSession.createdAt),
        ended_at: testSession.endedAt ? new Date(testSession.endedAt) : null,
        metadata: testSession,
        last_synced_at: new Date()
      };
      
      await Session.findOneAndUpdate(
        { session_id: testSession.sessionId },
        { $set: sessionDoc },
        { upsert: true }
      );
      console.log('✅ Session stored in MongoDB');
      
      // Insert test logs
      if (logs.length > 0) {
        const testLog = logs[0];
        const logId = `log_${testSession.sessionId}_${testLog.timestamp.replace(/[:\.\-]/g, '').substring(0, 15)}`;
        
        const logDoc = {
          log_id: logId,
          session_id: testSession.sessionId,
          agent_id: testAgent.id,
          agent_name: testAgent.name,
          timestamp: new Date(testLog.timestamp),
          level: 'info',
          message: testLog.log?.substring(0, 500) || '',
          data: testLog,
          created_at: new Date()
        };
        
        await Log.updateOne(
          { log_id: logId },
          { $setOnInsert: logDoc },
          { upsert: true }
        );
        console.log('✅ Log stored in MongoDB');
      }
      
      // 5. Verify counts
      const agentCount = await Agent.countDocuments();
      const sessionCount = await Session.countDocuments();
      const logCount = await Log.countDocuments();
      
      console.log('\n📊 MongoDB counts:');
      console.log(`Agents: ${agentCount}`);
      console.log(`Sessions: ${sessionCount}`);
      console.log(`Logs: ${logCount}`);
    }
    
    console.log('\n🎉 Complete sync test successful!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await db.disconnect();
  }
}

testCompleteSync();