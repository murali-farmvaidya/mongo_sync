require('dotenv').config();
const PipecatClient = require('./src/config/pipecat');
const fs = require('fs');

async function diagnose() {
    const client = new PipecatClient();
    const output = [];

    const log = (msg) => {
        console.log(msg);
        output.push(msg);
    };

    try {
        log('=== PIPECAT LOG DIAGNOSIS ===\n');

        // Get first agent
        const agents = await client.getAllAgents();
        const agent = agents[0];
        log(`Agent: ${agent.name} (${agent.id})`);

        // Get first session
        const sessions = await client.getAllSessionsForAgent(agent.name);
        const session = sessions[0];
        log(`Session: ${session.sessionId}\n`);

        // Fetch 2 pages (200 logs) for testing
        log('Fetching 200 logs...');
        const page1 = await client.getAgentLogs(agent.name, session.sessionId, 1, 100);
        const page2 = await client.getAgentLogs(agent.name, session.sessionId, 2, 100);
        const allLogs = [...(page1.data || []), ...(page2.data || [])];
        log(`Total logs fetched: ${allLogs.length}\n`);

        // Test patterns
        let chatMatch = 0;
        let ttsMatch = 0;
        let userMsgFound = 0;
        let noMatch = 0;

        const chatPattern = 'Generating chat from universal context';
        const ttsPattern = 'Generating TTS [';
        const userRegex = /'role':\s*'user',\s*'content':\s*'([^']*(?:''[^']*)*)'/;
        const ttsRegex = /Generating TTS \[(.+)\]/;

        log('=== PATTERN MATCHING RESULTS ===\n');

        for (let i = 0; i < allLogs.length; i++) {
            const logEntry = allLogs[i];
            const msg = logEntry.log || '';

            if (msg.includes(chatPattern)) {
                chatMatch++;
                const userMatch = msg.match(userRegex);
                if (userMatch) {
                    userMsgFound++;
                    if (chatMatch <= 3) {
                        log(`[${i}] CHAT LOG with USER message:`);
                        log(`    Content: "${userMatch[1].substring(0, 100)}..."`);
                    }
                } else {
                    if (chatMatch <= 3) {
                        log(`[${i}] CHAT LOG (no user message in this context)`);
                        // Check if there's 'role': 'user' anywhere
                        if (msg.includes("'role': 'user'")) {
                            log(`    WARNING: Contains 'role': 'user' but regex didn't match!`);
                            // Print a sample around 'role': 'user'
                            const idx = msg.indexOf("'role': 'user'");
                            log(`    Sample: ...${msg.substring(idx, idx + 100)}...`);
                        }
                    }
                }
            } else if (msg.includes(ttsPattern)) {
                ttsMatch++;
                const match = msg.match(ttsRegex);
                if (match && ttsMatch <= 3) {
                    log(`[${i}] TTS LOG: "${match[1].substring(0, 80)}..."`);
                }
            } else {
                noMatch++;
            }
        }

        log('\n=== SUMMARY ===');
        log(`Total logs: ${allLogs.length}`);
        log(`Chat context logs: ${chatMatch}`);
        log(`  - With user message: ${userMsgFound}`);
        log(`TTS logs: ${ttsMatch}`);
        log(`Other logs (skipped): ${noMatch}`);
        log(`Expected inserts: ${userMsgFound + ttsMatch}`);

        if (userMsgFound + ttsMatch === 0) {
            log('\n⚠️  NO MATCHES FOUND - Patterns may need adjustment!');
            // Print first 3 log samples
            log('\n=== SAMPLE LOGS ===');
            for (let i = 0; i < Math.min(3, allLogs.length); i++) {
                log(`\n--- Log ${i} ---`);
                log((allLogs[i].log || '').substring(0, 300));
            }
        }

    } catch (e) {
        log(`\nERROR: ${e.message}`);
        log(e.stack);
    }

    // Write to file
    fs.writeFileSync('diagnosis_output.txt', output.join('\n'), 'utf8');
    console.log('\n\nOutput saved to diagnosis_output.txt');
}

diagnose();
