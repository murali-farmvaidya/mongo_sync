require('dotenv').config();
const PipecatClient = require('./src/config/pipecat');
const fs = require('fs');

async function searchForConversationLogs() {
    const client = new PipecatClient();
    const output = [];

    const log = (msg) => {
        console.log(msg);
        output.push(msg);
    };

    try {
        log('=== SEARCHING FOR CONVERSATION LOGS ===\n');

        const agents = await client.getAllAgents();
        const agent = agents[0];
        log(`Agent: ${agent.name}`);

        const sessions = await client.getAllSessionsForAgent(agent.name);
        const session = sessions[0];
        log(`Session: ${session.sessionId}\n`);

        const chatPattern = 'Generating chat from universal context';
        const ttsPattern = 'Generating TTS [';

        let chatFound = 0;
        let ttsFound = 0;
        let totalScanned = 0;

        // Scan up to 50 pages (5000 logs)
        log('Scanning up to 50 pages...');
        for (let page = 1; page <= 50; page++) {
            const response = await client.getAgentLogs(agent.name, session.sessionId, page, 100);
            const logs = response.data || [];

            if (logs.length === 0) {
                log(`Page ${page}: No more logs`);
                break;
            }

            totalScanned += logs.length;

            for (const logEntry of logs) {
                const msg = logEntry.log || '';

                if (msg.includes(chatPattern)) {
                    chatFound++;
                    if (chatFound <= 5) {
                        log(`\n[Page ${page}] CHAT LOG FOUND:`);
                        log(`  ${msg.substring(0, 200)}...`);
                    }
                }

                if (msg.includes(ttsPattern)) {
                    ttsFound++;
                    if (ttsFound <= 5) {
                        log(`\n[Page ${page}] TTS LOG FOUND:`);
                        log(`  ${msg.substring(0, 200)}...`);
                    }
                }
            }

            // Progress
            if (page % 10 === 0) {
                log(`Scanned ${page} pages (${totalScanned} logs)... Chat: ${chatFound}, TTS: ${ttsFound}`);
            }

            if (!response.hasMore) break;
        }

        log('\n=== FINAL RESULTS ===');
        log(`Total logs scanned: ${totalScanned}`);
        log(`Chat context logs found: ${chatFound}`);
        log(`TTS logs found: ${ttsFound}`);
        log(`Total conversation logs: ${chatFound + ttsFound}`);

    } catch (e) {
        log(`ERROR: ${e.message}`);
    }

    fs.writeFileSync('search_results.txt', output.join('\n'), 'utf8');
    console.log('\nResults saved to search_results.txt');
}

searchForConversationLogs();
