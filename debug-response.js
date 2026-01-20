require('dotenv').config();
const axios = require('axios');

async function debugApiResponse() {
  const apiKey = process.env.PIPECAT_API_KEY;
  const baseURL = process.env.PIPECAT_BASE_URL;
  
  console.log('🔍 Debugging Pipecat API Response');
  console.log(`Using key: ${apiKey.substring(0, 10)}...`);
  
  const client = axios.create({
    baseURL,
    timeout: 10000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  
  try {
    console.log('\n1. Making request to /agents...');
    const response = await client.get('/agents');
    
    console.log(`✅ Status: ${response.status}`);
    console.log(`📊 Response headers:`, JSON.stringify(response.headers, null, 2));
    
    console.log('\n📦 Full response structure:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Analyze the response
    if (typeof response.data === 'object') {
      console.log('\n🔍 Response analysis:');
      console.log('Keys in response:', Object.keys(response.data));
      
      // Check common pagination patterns
      if (response.data.data && Array.isArray(response.data.data)) {
        console.log(`Found ${response.data.data.length} agents in data.data array`);
        if (response.data.data.length > 0) {
          console.log('First agent sample:', JSON.stringify(response.data.data[0], null, 2));
        }
      } else if (Array.isArray(response.data)) {
        console.log(`Found ${response.data.length} agents in root array`);
        if (response.data.length > 0) {
          console.log('First agent sample:', JSON.stringify(response.data[0], null, 2));
        }
      } else if (response.data.agents && Array.isArray(response.data.agents)) {
        console.log(`Found ${response.data.agents.length} agents in data.agents array`);
        if (response.data.agents.length > 0) {
          console.log('First agent sample:', JSON.stringify(response.data.agents[0], null, 2));
        }
      } else if (response.data.items && Array.isArray(response.data.items)) {
        console.log(`Found ${response.data.items.length} agents in data.items array`);
        if (response.data.items.length > 0) {
          console.log('First agent sample:', JSON.stringify(response.data.items[0], null, 2));
        }
      }
      
      // Check for pagination metadata
      if (response.data.total !== undefined) {
        console.log(`Total agents: ${response.data.total}`);
      }
      if (response.data.count !== undefined) {
        console.log(`Count: ${response.data.count}`);
      }
      if (response.data.page !== undefined) {
        console.log(`Page: ${response.data.page}`);
      }
      if (response.data.pages !== undefined) {
        console.log(`Total pages: ${response.data.pages}`);
      }
      if (response.data.limit !== undefined) {
        console.log(`Limit per page: ${response.data.limit}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.log('Response status:', error.response.status);
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

debugApiResponse();