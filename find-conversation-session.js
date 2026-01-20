require('dotenv').config();
const PipecatClient = require('./src/config/pipecat');
const fs = require('fs');

async function findConversationSession() {
    const client = new PipecatClient();
    const output = [];

    const log = (msg) => {
        console.log(msg);
        output.push(msg);
    };

    try {
        log('=== FINDING SESSION WITH CONVERSATIONS ===\n');

        const agents = await client.getAllAgents();
        const agent = agents[0];
        log(`Agent: ${agent.name}`);

        const sessions = await client.getAllSessionsForAgent(agent.name);
        log(`Total sessions: ${sessions.length}\n`);

        const chatPattern = 'Generating chat from universal context';
        const ttsPattern = 'Generating TTS [';

        // Check first 10 sessions
        for (let s = 0; s < Math.min(10, sessions.length); s++) {
            const session = sessions[s];
            log(`\nChecking session ${s + 1}: ${session.sessionId.substring(0, 8)}...`);

            // Get first page only for quick check
            const response = await client.getAgentLogs(agent.name, session.sessionId, 1, 100);
            const logs = response.data || [];

            let chatFound = 0;
            let ttsFound = 0;
            let sampleLog = '';

            for (const logEntry of logs) {
                const msg = logEntry.log || '';
                if (msg.includes(chatPattern)) chatFound++;
                if (msg.includes(ttsPattern)) ttsFound++;
                if (!sampleLog && msg.length > 50) sampleLog = msg.substring(0, 100);
            }

            log(`  Logs: ${logs.length}, Chat: ${chatFound}, TTS: ${ttsFound}`);
            if (chatFound > 0 || ttsFound > 0) {
                log(`  ✓ FOUND CONVERSATION SESSION!`);
            }
            log(`  Sample: ${sampleLog}...`);
        }

    } catch (e) {
        log(`ERROR: ${e.message}`);
    }

    fs.writeFileSync('session_search.txt', output.join('\n'), 'utf8');
    console.log('\nResults saved to session_search.txt');
}

findConversationSession();
