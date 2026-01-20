require('dotenv').config();
const { Database, Agent, Session, Log } = require('./src/config/db');

async function checkMongoDB() {
  console.log('🔍 Checking MongoDB data...');
  
  const db = new Database();
  
  try {
    await db.connect();
    
    const agentCount = await Agent.countDocuments();
    const sessionCount = await Session.countDocuments();
    const logCount = await Log.countDocuments();
    
    console.log(`📊 Counts:`);
    console.log(`  Agents: ${agentCount}`);
    console.log(`  Sessions: ${sessionCount}`);
    console.log(`  Logs: ${logCount}`);
    
    if (agentCount > 0) {
      console.log('\n📋 Sample agent:');
      const sampleAgent = await Agent.findOne({}, { agent_id: 1, name: 1, created_at: 1 });
      console.log(sampleAgent);
    }
    
    if (sessionCount > 0) {
      console.log('\n📋 Sample session:');
      const sampleSession = await Session.findOne({}, { session_id: 1, agent_name: 1, started_at: 1 });
      console.log(sampleSession);
    }
    
    if (logCount > 0) {
      console.log('\n📋 Sample log:');
      const sampleLog = await Log.findOne({}, { log_id: 1, session_id: 1, timestamp: 1, message: { $slice: 50 } });
      console.log(sampleLog);
    }
    
  } catch (error) {
    console.error('❌ Error checking MongoDB:', error.message);
  } finally {
    await db.disconnect();
  }
}

checkMongoDB();