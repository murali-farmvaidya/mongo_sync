require('dotenv').config();
const axios = require('axios');

async function testEndpoints() {
  const apiKey = process.env.PIPECAT_API_KEY;
  const baseURL = process.env.PIPECAT_BASE_URL;
  
  console.log('🔍 Testing Pipecat API Endpoints');
  
  const client = axios.create({
    baseURL,
    timeout: 10000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  try {
    // 1. Test /services endpoint
    console.log('\n1. Testing /services endpoint...');
    const servicesRes = await client.get('/services');
    const services = servicesRes.data.services || servicesRes.data;
    console.log(`✅ Found ${services.length} services`);
    
    if (services.length > 0) {
      const firstService = services[0];
      console.log('First service:', {
        id: firstService.id,
        name: firstService.name,
        region: firstService.region
      });
      
      // 2. Test /services/{id}/sessions
      console.log(`\n2. Testing /services/${firstService.id}/sessions...`);
      try {
        const sessionsRes = await client.get(`/services/${firstService.id}/sessions`);
        const sessions = sessionsRes.data.sessions || sessionsRes.data;
        console.log(`✅ Found ${sessions.length} sessions`);
        
        if (sessions.length > 0) {
          const firstSession = sessions[0];
          console.log('First session:', {
            id: firstSession.id,
            status: firstSession.status,
            created: firstSession.createdAt
          });
          
          // 3. Test /services/{id}/logs with sessionId
          console.log(`\n3. Testing /services/${firstService.id}/logs?sessionId=${firstSession.id}...`);
          try {
            const logsRes = await client.get(`/services/${firstService.id}/logs`, {
              params: { sessionId: firstSession.id }
            });
            const logs = logsRes.data.logs || logsRes.data;
            console.log(`✅ Found ${logs.length} logs`);
            
            if (logs.length > 0) {
              console.log('First log:', {
                id: logs[0].id,
                level: logs[0].level,
                message: logs[0].message?.substring(0, 50) + '...'
              });
            }
          } catch (logError) {
            console.log('⚠️ Logs endpoint error:', logError.response?.status || logError.message);
          }
        }
      } catch (sessionError) {
        console.log('⚠️ Sessions endpoint error:', sessionError.response?.status || sessionError.message);
      }
    }
    
    console.log('\n🎉 Endpoint testing completed!');
    
  } catch (error) {
    console.error('\n❌ API Test Failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`Error: ${error.message}`);
    }
  }
}

testEndpoints();