/**
 * Complete Dashboard Data Sync - FINAL ROBUST VERSION
 * 
 * Syncs all data needed for the dashboard:
 * 1. Agents - all Pipecat agents
 * 2. Sessions - all sessions per agent
 * 3. Conversations - properly ordered Q&A pairs per session
 * 
 * ROBUSTNESS FEATURES:
 * - Fetches both "Universal" and "LLM-specific" context logs
 * - Cleans "Knowledge Base Context" from user messages
 * - Robust parsing of Python-style dict strings in logs
 */

const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// ============ SCHEMAS ============

const agentSchema = new mongoose.Schema({
    agent_id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    created_at: Date,
    updated_at: Date,
    session_count: { type: Number, default: 0 },
    last_synced: { type: Date, default: Date.now }
}, { timestamps: true });

const sessionSchema = new mongoose.Schema({
    session_id: { type: String, required: true, unique: true },
    agent_id: String,
    agent_name: String,
    started_at: Date,
    ended_at: Date,
    status: String,
    conversation_count: { type: Number, default: 0 },
    last_synced: { type: Date, default: Date.now }
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
    session_id: { type: String, required: true, index: true },
    agent_id: String,
    agent_name: String,
    turns: [{
        turn_id: Number,
        user_message: String,
        assistant_message: String,
        timestamp: Date
    }],
    total_turns: Number,
    first_message_at: Date,
    last_message_at: Date,
    last_synced: { type: Date, default: Date.now }
}, { timestamps: true });

conversationSchema.index({ session_id: 1 }, { unique: true });

const Agent = mongoose.model('Agent', agentSchema);
const Session = mongoose.model('Session', sessionSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

// ============ PARSING HELPERS ============

function extractSessionId(logMessage) {
    const match = logMessage.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

function cleanUserMessage(msg) {
    if (!msg) return msg;
    // Remove Knowledge Base Context block
    if (msg.includes('[KNOWLEDGE BASE CONTEXT]')) {
        // Replace the block up to the end of json code block
        return msg.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?```json[\s\S]*?```\s*/, '').trim();
    }
    return msg;
}

/**
 * Parse conversation from context log (Universal or LLM-specific)
 */
function parseContextLog(logMessage) {
    const turns = [];

    // Robust regex to find the array content at end of log
    // Matches "context [ ... ]" 
    const arrayMatch = logMessage.match(/context \[(.+)\]$/s);
    if (!arrayMatch) return [];

    const arrayContent = arrayMatch[1];

    // Extract individual messages based on 'role' position
    const messages = [];

    let pos = 0;
    while (pos < arrayContent.length) {
        // Find next role definition
        const userMatch = arrayContent.indexOf("'role': 'user'", pos);
        const assistantMatch = arrayContent.indexOf("'role': 'assistant'", pos);
        const systemMatch = arrayContent.indexOf("'role': 'system'", pos);

        // Find the nearest match
        const matches = [
            { type: 'user', pos: userMatch },
            { type: 'assistant', pos: assistantMatch },
            { type: 'system', pos: systemMatch }
        ].filter(m => m.pos !== -1).sort((a, b) => a.pos - b.pos);

        if (matches.length === 0) break;

        const nearest = matches[0];

        // Extract content for this message
        const contentStart = arrayContent.indexOf("'content': '", nearest.pos);
        if (contentStart === -1 || contentStart > nearest.pos + 100) {
            pos = nearest.pos + 10;
            continue;
        }

        // Find the end of content
        const contentValueStart = contentStart + "'content': '".length;
        let contentEnd = contentValueStart;
        let escaped = false;

        while (contentEnd < arrayContent.length) {
            const char = arrayContent[contentEnd];
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === "'") {
                // Check if this is the end
                const after = arrayContent.substring(contentEnd + 1, contentEnd + 3);
                if (after.startsWith('}') || after.startsWith(', ') || after.startsWith('}\n')) {
                    break;
                }
            }
            contentEnd++;
        }

        const content = arrayContent.substring(contentValueStart, contentEnd)
            .replace(/\\'/g, "'")
            .replace(/\\n/g, "\n");

        if (nearest.type !== 'system' && content.length > 0) {
            messages.push({ role: nearest.type, content });
        }

        pos = contentEnd + 1;
    }

    // Pair user messages with assistant responses
    let turnId = 0;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            turnId++;

            // CLEAN the user message
            const cleanContent = cleanUserMessage(messages[i].content);

            const turn = {
                turn_id: turnId,
                user_message: cleanContent,
                assistant_message: null,
                timestamp: new Date()
            };

            if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                turn.assistant_message = messages[i + 1].content;
                i++;
            }

            if (turn.user_message && turn.user_message.length > 0) {
                turns.push(turn);
            }
        }
    }

    return turns;
}

// ============ SYNC FUNCTIONS ============

async function syncAgents(client) {
    logger.info('\n📦 Syncing Agents...');
    const agents = await client.getAllAgents();
    let synced = 0;

    for (const agent of agents) {
        await Agent.findOneAndUpdate(
            { agent_id: agent.id },
            {
                agent_id: agent.id,
                name: agent.name,
                created_at: agent.createdAt ? new Date(agent.createdAt) : new Date(),
                updated_at: agent.updatedAt ? new Date(agent.updatedAt) : new Date(),
                last_synced: new Date()
            },
            { upsert: true }
        );
        synced++;
    }
    logger.info(`✅ Synced ${synced} agents`);
    return agents;
}

async function syncSessions(client, agents) {
    logger.info('\n📦 Syncing Sessions...');
    let totalSynced = 0;

    for (const agent of agents) {
        const sessions = await client.getAllSessionsForAgent(agent.name);
        for (const session of sessions) {
            await Session.findOneAndUpdate(
                { session_id: session.sessionId },
                {
                    session_id: session.sessionId,
                    agent_id: agent.id,
                    agent_name: agent.name,
                    started_at: session.createdAt ? new Date(session.createdAt) : new Date(),
                    ended_at: session.endedAt ? new Date(session.endedAt) : null,
                    status: session.completionStatus || 'unknown',
                    last_synced: new Date()
                },
                { upsert: true }
            );
            totalSynced++;
        }
        await Agent.updateOne({ agent_id: agent.id }, { session_count: sessions.length });
        logger.info(`  Agent ${agent.name}: ${sessions.length} sessions`);
    }
    logger.info(`✅ Synced ${totalSynced} sessions`);
}

async function syncConversations(client, agents) {
    logger.info('\n📦 Syncing Conversations...');

    let totalSynced = 0;
    let totalSkipped = 0;

    for (const agent of agents) {
        logger.info(`  Processing agent: ${agent.name}`);

        let page = 1;
        const limit = 100;
        const sessionContexts = new Map();

        while (true) {
            // Query "Generating chat" to match both Universal and LLM-specific
            const response = await client.getAgentLogs(agent.name, null, page, limit, 'Generating chat');
            const logs = response.data || [];

            if (!logs || logs.length === 0) break;

            for (const log of logs) {
                const msg = log.log || '';

                if (!msg.includes('Generating chat from') || !msg.includes('context [')) continue;

                const sessionId = extractSessionId(msg);
                if (!sessionId) continue;

                const logTime = new Date(log.timestamp);
                const isUniversal = msg.includes('universal context');

                const current = sessionContexts.get(sessionId);

                if (!current) {
                    sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                } else {
                    // Priority: Universal > LLM-specific
                    // If we found a Universal context and current is LLM-specific, REPLACE it
                    if (isUniversal && !current.isUniversal) {
                        sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                    }
                    // If types are same, keep NEWER
                    else if (isUniversal === current.isUniversal && logTime > current.time) {
                        sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                    }
                }
            }

            if (!response.hasMore || logs.length < limit) break;
            page++;
            await client.delay(100);
        }

        logger.info(`    Found ${sessionContexts.size} sessions with chat context`);

        for (const [sessionId, { log: contextLog, time, isUniversal }] of sessionContexts) {
            try {
                const turns = parseContextLog(contextLog);

                if (turns.length === 0) {
                    totalSkipped++;
                    continue;
                }

                await Conversation.findOneAndUpdate(
                    { session_id: sessionId },
                    {
                        session_id: sessionId,
                        agent_id: agent.id,
                        agent_name: agent.name,
                        turns: turns,
                        total_turns: turns.length,
                        first_message_at: turns[0]?.timestamp || time,
                        last_message_at: time,
                        last_synced: new Date()
                    },
                    { upsert: true }
                );

                await Session.updateOne(
                    { session_id: sessionId },
                    { conversation_count: turns.length }
                );

                totalSynced++;
            } catch (e) {
                // logger.debug(`  Skip ${sessionId}: ${e.message}`);
                totalSkipped++;
            }
        }
    }

    logger.info(`✅ Synced ${totalSynced} conversations, skipped ${totalSkipped}`);
}

async function main() {
    logger.info('🚀 Starting Dashboard Data Sync (ROBUST)...\n');

    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
    logger.info('✅ MongoDB connected');

    const client = new PipecatClient();

    const agents = await syncAgents(client);
    await syncSessions(client, agents);
    await syncConversations(client, agents);

    // Usage Summary
    const agentCount = await Agent.countDocuments();
    const sessionCount = await Session.countDocuments();
    const conversationCount = await Conversation.countDocuments();

    logger.info('\n========== SYNC SUMMARY ==========');
    logger.info(`Agents:        ${agentCount}`);
    logger.info(`Sessions:      ${sessionCount}`);
    logger.info(`Conversations: ${conversationCount}`);
    logger.info('==================================\n');

    // Show Clean Sample
    const sample = await Conversation.findOne({ total_turns: { $gt: 0 } }).sort({ total_turns: -1 });
    if (sample && sample.turns && sample.turns.length > 0) {
        logger.info('📋 Sample Conversation (Cleaned):');
        logger.info(`   Session: ${sample.session_id}`);
        logger.info(`   Turns: ${sample.total_turns}`);
        for (let i = 0; i < Math.min(3, sample.turns.length); i++) {
            const turn = sample.turns[i];
            logger.info(`\n   Turn ${turn.turn_id}:`);
            logger.info(`     User: "${(turn.user_message || '').substring(0, 80)}..."`);
            logger.info(`     Asst: "${(turn.assistant_message || '').substring(0, 80)}..."`);
        }
    }

    await mongoose.disconnect();
    logger.info('\n✅ Sync complete!');
}

main().catch(e => {
    logger.error('Sync failed:', e);
    process.exit(1);
});
