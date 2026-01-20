require('dotenv').config();
const axios = require('axios');

async function debugSessions() {
  const apiKey = process.env.PIPECAT_API_KEY;
  const baseURL = process.env.PIPECAT_BASE_URL;
  
  console.log('🔍 Debugging Sessions API Response');
  
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
      params: { limit: 5 } // Get just 5 to see structure
    });
    
    console.log('Response status:', sessionsRes.status);
    console.log('Response headers:', JSON.stringify(sessionsRes.headers, null, 2));
    
    const sessions = sessionsRes.data.sessions || sessionsRes.data || [];
    console.log(`\nFound ${sessions.length} sessions`);
    
    // Show raw session data
    console.log('\n📊 Raw session data structure:');
    console.log(JSON.stringify(sessions, null, 2));
    
    // Analyze session structure
    if (sessions.length > 0) {
      console.log('\n🔍 Analyzing first session:');
      const firstSession = sessions[0];
      
      console.log('Session keys:', Object.keys(firstSession));
      console.log('Full session:', JSON.stringify(firstSession, null, 2));
      
      // Check for ID in different possible fields
      const idFields = ['id', 'sessionId', 'session_id', 'sessionID', '_id', 'uid'];
      let foundId = null;
      
      for (const field of idFields) {
        if (firstSession[field]) {
          foundId = { field, value: firstSession[field] };
          break;
        }
      }
      
      if (foundId) {
        console.log(`✅ Found ID in field "${foundId.field}": ${foundId.value}`);
      } else {
        console.log('❌ No ID field found in session data');
        console.log('Available fields:', Object.keys(firstSession));
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

debugSessions();