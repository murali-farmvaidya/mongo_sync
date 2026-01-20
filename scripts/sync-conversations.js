/**
 * Optimized sync script that fetches ONLY conversation logs (TTS and chat)
 * using the Pipecat API's query parameter for server-side filtering.
 * This is MUCH faster than fetching all logs.
 */

const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const { Log } = require(path.join(__dirname, '../src/config/db'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// Patterns for extracting conversation content
const ttsPattern = /Generating TTS:?\s*\[(.+)\]/;
const chatPattern = (msg) => msg.includes('Generating chat from') && msg.includes('context [');
const userContentPattern = /'role':\s*'user',\s*'content':\s*'([^']*(?:''[^']*)*)'/;

async function processLog(log, agentId, agentName) {
    const msg = log.log || '';
    let type = null;
    let content = null;

    // Check TTS (assistant response)
    const ttsMatch = msg.match(ttsPattern);
    if (ttsMatch) {
        type = 'response';
        content = ttsMatch[1].trim();
    }
    // Check Chat (user question)
    else if (chatPattern(msg)) {
        const userMatch = msg.match(userContentPattern);
        if (userMatch) {
            type = 'question';
            content = userMatch[1].replace(/''/g, "'");
        }
    }

    if (!type || !content) return null;

    // Extract session ID from log message (UUID format)
    const sessionMatch = msg.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const sessionId = sessionMatch ? sessionMatch[1] : 'unknown';

    return {
        log_id: `${sessionId}_${log.timestamp}_${type}`,
        session_id: sessionId,
        agent_id: agentId,
        agent_name: agentName,
        timestamp: new Date(log.timestamp),
        level: 'INFO',
        message: content,
        data: {
            type,
            role: type === 'question' ? 'user' : 'assistant',
            content
        },
        created_at: new Date(log.timestamp)
    };
}

async function syncConversations() {
    logger.info('🚀 Starting optimized conversation sync...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
    logger.info('✅ MongoDB connected');

    const client = new PipecatClient();

    // Get all agents
    const agents = await client.getAllAgents();
    logger.info(`Found ${agents.length} agents`);

    let totalInserted = 0;
    let totalSkipped = 0;

    for (const agent of agents) {
        logger.info(`\n📦 Processing agent: ${agent.name}`);

        const processBatch = async (logs, logType) => {
            const operations = [];

            for (const log of logs) {
                const doc = await processLog(log, agent.id, agent.name);
                if (doc) {
                    operations.push({
                        updateOne: {
                            filter: { log_id: doc.log_id },
                            update: { $setOnInsert: doc },
                            upsert: true
                        }
                    });
                }
            }

            if (operations.length > 0) {
                try {
                    const result = await Log.bulkWrite(operations, { ordered: false });
                    totalInserted += result.upsertedCount;
                    totalSkipped += operations.length - result.upsertedCount;
                    logger.info(`  [${logType}] Inserted: ${result.upsertedCount}, Skipped: ${operations.length - result.upsertedCount}`);
                } catch (e) {
                    logger.warn(`  [${logType}] Bulk insert error: ${e.message}`);
                }
            }
        };

        await client.getConversationLogs(agent.name, processBatch);
    }

    logger.info(`\n✅ Sync complete! Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);

    await mongoose.disconnect();
}

syncConversations().catch(e => {
    logger.error('Sync failed:', e);
    process.exit(1);
});
