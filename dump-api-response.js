require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function main() {
    const client = axios.create({
        baseURL: process.env.PIPECAT_BASE_URL || 'https://api.pipecat.daily.co/v1',
        headers: {
            'Authorization': `Bearer ${process.env.PIPECAT_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    try {
        // Get logs with query parameter
        const resp = await client.get('/agents/v3/logs', {
            params: {
                limit: 5,
                query: 'TTS'
            }
        });

        // Write raw response to file
        fs.writeFileSync('raw_api_response.json', JSON.stringify(resp.data, null, 2), 'utf8');
        console.log('Saved to raw_api_response.json');
        console.log('Total:', resp.data.total || 'N/A');
        console.log('Logs count:', (resp.data.logs || resp.data || []).length);

    } catch (e) {
        console.error('Error:', e.message);
    }
}

main();
