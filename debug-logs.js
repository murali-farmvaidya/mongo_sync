require('dotenv').config();
const axios = require('axios');

async function debugLogs() {
  const apiKey = process.env.PIPECAT_API_KEY;
  const baseURL = process.env.PIPECAT_BASE_URL;
  
  console.log('🔍 Debugging Logs API Response');
  
  const client = axios.create({
    baseURL,
    timeout: 10000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  try {
    // Get first agent
    console.log('1. Getting agents...');
    const agentsRes = await client.get('/agents');
    const agents = agentsRes.data.services || agentsRes.data;
    
    if (agents.length === 0) {
      console.log('No agents found');
      return;
    }
    
    const agent = agents[0];
    console.log(`Using agent: ${agent.name} (${agent.id})`);
    
    // Get sessions for this agent
    console.log(`\n2. Getting sessions for agent "${agent.name}"...`);
    const sessionsRes = await client.get(`/agents/${agent.name}/sessions`, {
      params: { limit: 1 }
    });
    
    const sessions = sessionsRes.data.sessions || sessionsRes.data || [];
    
    if (sessions.length === 0) {
      console.log('No sessions found for this agent');
      return;
    }
    
    const session = sessions[0];
    console.log(`Using session: ${session.sessionId}`);
    
    // Get logs for this session
    console.log(`\n3. Getting logs for session "${session.sessionId}"...`);
    const logsRes = await client.get(`/agents/${agent.name}/logs`, {
      params: { 
        sessionId: session.sessionId,
        limit: 3
      }
    });
    
    console.log('Response status:', logsRes.status);
    console.log('Response keys:', Object.keys(logsRes.data));
    
    const logs = logsRes.data.logs || logsRes.data || [];
    console.log(`\nFound ${logs.length} logs`);
    
    // Show raw log data
    if (logs.length > 0) {
      console.log('\n📊 Raw log data structure:');
      console.log(JSON.stringify(logs, null, 2));
      
      console.log('\n🔍 Analyzing first log:');
      const firstLog = logs[0];
      console.log('Log keys:', Object.keys(firstLog));
      
      // Check for ID in different possible fields
      const idFields = ['id', 'logId', 'log_id', '_id', 'uid'];
      let foundId = null;
      
      for (const field of idFields) {
        if (firstLog[field]) {
          foundId = { field, value: firstLog[field] };
          break;
        }
      }
      
      if (foundId) {
        console.log(`✅ Found ID in field "${foundId.field}": ${foundId.value}`);
      } else {
        console.log('❌ No ID field found in log data');
        console.log('Available fields:', Object.keys(firstLog));
        
        // Check if we can construct an ID
        if (firstLog.timestamp || firstLog.createdAt) {
          const timestamp = firstLog.timestamp || firstLog.createdAt;
          const constructedId = `log_${session.sessionId}_${timestamp}`;
          console.log(`Constructed ID: ${constructedId}`);
        }
      }
    } else {
      console.log('⚠️ No logs found for this session');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

debugLogs();