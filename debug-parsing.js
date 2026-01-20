/**
 * Debug script to test parsing of universal context logs
 */

const path = require('path');
require('dotenv').config();
const PipecatClient = require(path.join(__dirname, 'src/config/pipecat'));

async function debug() {
    const client = new PipecatClient();

    console.log('Fetching universal context logs...\n');

    // Fetch a few logs
    const response = await client.getAgentLogs('v3', null, 1, 10, 'universal context');
    const logs = response.data || [];

    console.log(`Found ${logs.length} logs\n`);

    for (const log of logs.slice(0, 3)) {
        const msg = log.log || '';
        console.log('='.repeat(80));
        console.log('RAW LOG (first 500 chars):');
        console.log(msg.substring(0, 500));
        console.log('\n');

        // Check if it matches
        if (msg.includes('Generating chat from universal context [')) {
            console.log('✅ MATCHES universal context pattern');

            // Try to extract messages manually
            const userMatches = msg.match(/'role':\s*'user',\s*'content':\s*'([^}]+)'/g);
            const assistantMatches = msg.match(/'role':\s*'assistant',\s*'content':\s*'([^}]+)'/g);

            console.log(`\nFound ${userMatches?.length || 0} user messages`);
            console.log(`Found ${assistantMatches?.length || 0} assistant messages`);

            if (userMatches && userMatches.length > 0) {
                console.log('\nFirst user match:', userMatches[0].substring(0, 100));
            }
        } else {
            console.log('❌ Does NOT match universal context pattern');
        }
        console.log('\n');
    }
}

debug().catch(e => console.error(e));
