require('dotenv').config();
const PipecatClient = require('./src/config/pipecat');

async function inspectLogs() {
    const client = new PipecatClient();

    try {
        console.log('Fetching sample logs...');

        // Get first agent
        const agents = await client.getAllAgents();
        const agent = agents[0];
        console.log(`Agent: ${agent.name}`);

        // Get first session
        const sessions = await client.getAllSessionsForAgent(agent.name);
        const session = sessions[0];
        console.log(`Session: ${session.sessionId}`);

        // Get first page of logs
        const logsResponse = await client.getAgentLogs(agent.name, session.sessionId, 1, 10);
        const logs = logsResponse.data;

        console.log(`\n=== SAMPLE LOGS (${logs.length}) ===\n`);

        for (let i = 0; i < Math.min(logs.length, 5); i++) {
            const log = logs[i];
            console.log(`--- LOG ${i} ---`);
            console.log(`Timestamp: ${log.timestamp}`);
            console.log(`Log Content:`);
            console.log(log.log);
            console.log('');
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

inspectLogs();
