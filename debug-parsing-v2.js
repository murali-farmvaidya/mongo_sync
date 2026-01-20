/**
 * Debug script to test parsing of universal context logs
 * V2: Query "Generating chat" and check content
 */

const path = require('path');
require('dotenv').config();
const PipecatClient = require(path.join(__dirname, 'src/config/pipecat'));

async function debug() {
    const client = new PipecatClient();

    console.log('Fetching "Generating chat" logs (limit 100)...\n');

    // Query for "Generating chat" which should return both types
    const response = await client.getAgentLogs('v3', null, 1, 100, 'Generating chat');
    const logs = response.data || [];

    console.log(`Found ${logs.length} logs\n`);

    let universalCount = 0;
    let llmSpecificCount = 0;
    let otherCount = 0;

    let sampleUniversal = null;

    for (const log of logs) {
        const msg = log.log || '';

        if (msg.includes('Generating chat from universal context [')) {
            universalCount++;
            if (!sampleUniversal) sampleUniversal = msg;
        } else if (msg.includes('Generating chat from LLM-specific context [')) {
            llmSpecificCount++;
        } else {
            otherCount++;
        }
    }

    console.log(`Summary:`);
    console.log(`  Universal Context:    ${universalCount}`);
    console.log(`  LLM-specific Context: ${llmSpecificCount}`);
    console.log(`  Other:                ${otherCount}`);

    if (sampleUniversal) {
        console.log('\n✅ Sample Universal Context Log (first 300 chars):');
        console.log(sampleUniversal.substring(0, 300));

        // Test parsing on this sample
        console.log('\n--- Parsing Test ---');
        const turns = parseLog(sampleUniversal);
        console.log(`Extracted ${turns.length} turns`);
        turns.forEach(t => {
            console.log(`[Turn ${t.turn_id}] User: "${t.user_message?.substring(0, 50)}..."`);
        });
    } else {
        console.log('\n❌ NO universal context logs found in the first 100 results.');
    }
}

function parseLog(logMessage) {
    // Parse conversation from UNIVERSAL context log
    const turns = [];

    // Robust extraction logic (simulated/simplified from sync script)
    // Find array content
    const match = logMessage.match(/universal context \[(.+)\]$/s);
    if (!match) return [];
    const content = match[1];

    // Simple regex for test
    const userMatches = [...content.matchAll(/'role':\s*'user',\s*'content':\s*'((?:[^'\\]|\\.|'(?=[^}]*\{))*)'/g)];

    let turnId = 0;
    for (const m of userMatches) {
        turnId++;
        turns.push({ turn_id: turnId, user_message: m[1] });
    }
    return turns;
}

debug().catch(e => console.error(e));
