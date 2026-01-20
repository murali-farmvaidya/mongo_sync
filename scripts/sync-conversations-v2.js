/**
 * Sync conversations from Pipecat API
 * 
 * This script fetches the LAST "Generating chat from universal context" log per session
 * which contains the COMPLETE conversation history with all user/assistant pairs.
 */

const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// Define Conversation schema
const conversationSchema = new mongoose.Schema({
    session_id: { type: String, required: true, unique: true },
    agent_id: String,
    agent_name: String,
    started_at: Date,
    ended_at: Date,
    turns: [{
        turn_id: Number,
        user_message: String,
        assistant_message: String,
        timestamp: Date
    }],
    total_turns: Number,
    last_synced: { type: Date, default: Date.now }
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

// Pattern to match context logs
const contextPattern = (msg) => msg.includes('Generating chat from') && msg.includes('context [');

// Extract conversation array from log message
function extractConversationArray(logMessage) {
    try {
        // Find the array part: starts with [ and ends with ]
        const match = logMessage.match(/context \[(.+)\]$/s);
        if (!match) return null;

        // The content is Python-style dict, need to convert to JSON
        let content = '[' + match[1] + ']';

        // Convert Python single quotes to double quotes
        // Be careful with apostrophes inside content
        content = content
            .replace(/'/g, '"')  // Replace all single quotes
            .replace(/True/g, 'true')
            .replace(/False/g, 'false')
            .replace(/None/g, 'null');

        // This is tricky - the content may have escaped quotes
        // Try to parse, if fails return null
        try {
            return JSON.parse(content);
        } catch (e) {
            // Fallback: use regex to extract user/assistant pairs
            return extractWithRegex(logMessage);
        }
    } catch (e) {
        return null;
    }
}

// Fallback regex extraction
function extractWithRegex(logMessage) {
    const turns = [];

    // Match user messages: {'role': 'user', 'content': '...'}
    const userPattern = /\{'role':\s*'user',\s*'content':\s*'([^}]+)'\}/g;
    // Match assistant messages: {'role': 'assistant', 'content': '...'}
    const assistantPattern = /\{'role':\s*'assistant',\s*'content':\s*'([^}]+)'\}/g;

    let userMatch;
    while ((userMatch = userPattern.exec(logMessage)) !== null) {
        turns.push({ role: 'user', content: userMatch[1] });
    }

    let assistantMatch;
    while ((assistantMatch = assistantPattern.exec(logMessage)) !== null) {
        turns.push({ role: 'assistant', content: assistantMatch[1] });
    }

    return turns;
}

// Parse conversation from context array
function parseConversation(contextArray) {
    const turns = [];
    let currentTurn = null;
    let turnId = 0;

    for (const msg of contextArray) {
        if (!msg || !msg.role) continue;

        // Skip system messages
        if (msg.role === 'system') continue;

        if (msg.role === 'user') {
            // If there's a pending turn without response, save it
            if (currentTurn && currentTurn.user_message) {
                turns.push(currentTurn);
            }
            // Start new turn
            turnId++;
            currentTurn = {
                turn_id: turnId,
                user_message: msg.content,
                assistant_message: null,
                timestamp: new Date()
            };
        } else if (msg.role === 'assistant' && currentTurn) {
            // Add response to current turn
            currentTurn.assistant_message = msg.content;
            turns.push(currentTurn);
            currentTurn = null;
        }
    }

    // Add any remaining turn
    if (currentTurn && currentTurn.user_message) {
        turns.push(currentTurn);
    }

    return turns;
}

async function syncConversations() {
    logger.info('🚀 Starting conversation sync...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
    logger.info('✅ MongoDB connected');

    const client = new PipecatClient();

    // Get all agents
    const agents = await client.getAllAgents();
    logger.info(`Found ${agents.length} agents`);

    let totalSynced = 0;
    let totalSkipped = 0;

    for (const agent of agents) {
        logger.info(`\n📦 Processing agent: ${agent.name}`);

        // Fetch chat context logs for this agent
        let page = 1;
        const limit = 100;
        const sessionContexts = new Map(); // session_id -> latest context log

        while (true) {
            const response = await client.getAgentLogs(agent.name, null, page, limit, 'Generating chat');
            const logs = response.data || [];

            if (!logs || logs.length === 0) break;

            for (const log of logs) {
                const msg = log.log || '';
                if (!contextPattern(msg)) continue;

                // Extract session ID from log
                const sessionMatch = msg.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                if (!sessionMatch) continue;

                const sessionId = sessionMatch[1];
                const logTime = new Date(log.timestamp);

                // Keep only the LATEST context log per session (most complete)
                if (!sessionContexts.has(sessionId) || logTime > sessionContexts.get(sessionId).time) {
                    sessionContexts.set(sessionId, { log: msg, time: logTime });
                }
            }

            logger.debug(`Fetched page ${page}: ${logs.length} logs`);

            if (!response.hasMore || logs.length < limit) break;
            page++;
            await client.delay(100);
        }

        logger.info(`Found ${sessionContexts.size} sessions with conversations`);

        // Process each session's conversation
        for (const [sessionId, { log: contextLog, time }] of sessionContexts) {
            try {
                // Extract conversation array
                const contextArray = extractConversationArray(contextLog);
                if (!contextArray || contextArray.length === 0) {
                    totalSkipped++;
                    continue;
                }

                // Parse into turns
                const turns = parseConversation(contextArray);
                if (turns.length === 0) {
                    totalSkipped++;
                    continue;
                }

                // Upsert conversation
                await Conversation.findOneAndUpdate(
                    { session_id: sessionId },
                    {
                        session_id: sessionId,
                        agent_id: agent.id,
                        agent_name: agent.name,
                        started_at: turns[0]?.timestamp || time,
                        ended_at: time,
                        turns: turns,
                        total_turns: turns.length,
                        last_synced: new Date()
                    },
                    { upsert: true, new: true }
                );

                totalSynced++;
                if (totalSynced % 10 === 0) {
                    logger.info(`  Synced ${totalSynced} conversations...`);
                }
            } catch (e) {
                logger.warn(`  Failed to sync session ${sessionId}: ${e.message}`);
                totalSkipped++;
            }
        }
    }

    logger.info(`\n✅ Sync complete! Synced: ${totalSynced}, Skipped: ${totalSkipped}`);

    // Show sample
    const sample = await Conversation.findOne().sort({ last_synced: -1 });
    if (sample) {
        logger.info('\n📋 Sample conversation:');
        logger.info(`   Session: ${sample.session_id}`);
        logger.info(`   Turns: ${sample.total_turns}`);
        if (sample.turns && sample.turns.length > 0) {
            logger.info(`   First turn: User: "${sample.turns[0].user_message?.substring(0, 50)}..."`);
            logger.info(`              Asst: "${sample.turns[0].assistant_message?.substring(0, 50)}..."`);
        }
    }

    await mongoose.disconnect();
}

syncConversations().catch(e => {
    logger.error('Sync failed:', e);
    process.exit(1);
});
