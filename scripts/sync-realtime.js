/**
 * Realtime Dashboard Data Sync - OPTIMIZED & ROBUST
 * 
 * Features:
 * 1. Syncs Agents, Sessions, and CLEAN Conversations (Q&A pairs only)
 * 2. Filters for data from January 1, 2026 onwards
 * 3. OPTIMIZED: Stops fetching logs once it hits data older than start date
 * 4. ROBUST CLEANING: Handles messy system prompts and escaped characters
 */

const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// ============ CONFIGURATION ============
const SYNC_START_DATE = new Date('2026-01-01T00:00:00Z');
const POLL_INTERVAL_MS = 60000; // Run every 60 seconds

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
    bot_start_seconds: { type: Number, default: 0 },
    cold_start: { type: Boolean, default: false },
    duration_seconds: { type: Number, default: 0 },
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
    if (msg.includes('[KNOWLEDGE BASE CONTEXT]')) {
        // 1. Try standard Markdown code block removal
        let cleaned = msg.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?```json[\s\S]*?```\s*/, '');

        // 2. Try escaped backticks (common in raw logs)
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            cleaned = cleaned.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?\\`\\`\\`json[\s\S]*?\\`\\`\\`\s*/, '');
        }

        // 3. Fallback: If still messy, assuming query is at the very end
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            const parts = cleaned.split('\n');
            // Take the last non-empty line that isn't part of the block
            for (let i = parts.length - 1; i >= 0; i--) {
                const line = parts[i].trim();
                if (line.length > 0 && !line.includes('```') && !line.includes('---')) {
                    return line;
                }
            }
        }

        return cleaned.trim();
    }
    return msg;
}

function parseContextLog(logMessage) {
    const turns = [];
    const arrayMatch = logMessage.match(/context \[(.+)\]$/s);
    if (!arrayMatch) return [];

    const arrayContent = arrayMatch[1];
    const messages = [];
    let pos = 0;

    while (pos < arrayContent.length) {
        const userMatch = arrayContent.indexOf("'role': 'user'", pos);
        const assistantMatch = arrayContent.indexOf("'role': 'assistant'", pos);

        let nextMsgPos = -1;
        let type = '';

        if (userMatch !== -1 && (assistantMatch === -1 || userMatch < assistantMatch)) {
            nextMsgPos = userMatch;
            type = 'user';
        } else if (assistantMatch !== -1) {
            nextMsgPos = assistantMatch;
            type = 'assistant';
        }

        if (nextMsgPos === -1) break;

        // Try single quote content
        let contentStart = arrayContent.indexOf("'content': '", nextMsgPos);
        let quoteChar = "'";

        // If not found or found AFTER the next role (unlikely but safe check), try double quote
        // Actually, just check which one comes first after nextMsgPos
        const doubleQuoteStart = arrayContent.indexOf("'content': \"", nextMsgPos);

        if (contentStart === -1 || (doubleQuoteStart !== -1 && doubleQuoteStart < contentStart)) {
            contentStart = doubleQuoteStart;
            quoteChar = '"';
        }

        if (contentStart === -1) {
            pos = nextMsgPos + 10;
            continue;
        }

        const contentValueStart = contentStart + ` 'content': ${quoteChar}`.length - 1; // 'content': ' is 12 chars. 'content': " is 12.
        // Actually length of "'content': '" is 12. 
        // length of "'content': \"" is 12.

        let contentEnd = contentValueStart;
        let escaped = false;

        while (contentEnd < arrayContent.length) {
            const char = arrayContent[contentEnd];
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quoteChar) {
                const after = arrayContent.substring(contentEnd + 1, contentEnd + 3);
                if (after.startsWith('}') || after.startsWith(', ') || after.startsWith('}\n') || after.startsWith('},')) {
                    break;
                }
            }
            contentEnd++;
        }

        const content = arrayContent.substring(contentValueStart, contentEnd)
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n");

        messages.push({ role: type, content });
        pos = contentEnd + 1;
    }

    let turnId = 0;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            turnId++;
            const userMsg = cleanUserMessage(messages[i].content);

            const turn = {
                turn_id: turnId,
                user_message: userMsg,
                assistant_message: null,
                timestamp: new Date()
            };

            if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                turn.assistant_message = messages[i + 1].content;
                i++;
            }

            if (turn.user_message && turn.user_message.trim().length > 0) {
                turns.push(turn);
            }
        }
    }

    return turns;
}

// ============ SYNC FUNCTIONS ============

async function syncAgents(client) {
    const agents = await client.getAllAgents();
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
    }
    return agents;
}

async function syncSessions(client, agents) {
    for (const agent of agents) {
        const sessions = await client.getAllSessionsForAgent(agent.name);

        for (const session of sessions) {
            const startedAt = session.createdAt ? new Date(session.createdAt) : new Date();
            if (startedAt < SYNC_START_DATE) continue;

            const endedAt = session.endedAt ? new Date(session.endedAt) : null;
            let durationSeconds = 0;
            if (endedAt && startedAt) {
                durationSeconds = Math.round((endedAt - startedAt) / 1000);
            }

            await Session.findOneAndUpdate(
                { session_id: session.sessionId },
                {
                    session_id: session.sessionId,
                    agent_id: agent.id,
                    agent_name: agent.name,
                    started_at: startedAt,
                    ended_at: endedAt,
                    status: session.completionStatus || 'unknown',
                    bot_start_seconds: session.botStartSeconds || 0,
                    cold_start: session.coldStart || false,
                    duration_seconds: durationSeconds,
                    last_synced: new Date()
                },
                { upsert: true }
            );
        }
    }
}

async function syncConversations(client, agents) {
    let totalSynced = 0;

    for (const agent of agents) {
        let page = 1;
        const limit = 100;
        const sessionContexts = new Map();
        let stopFetchingForAgent = false;

        while (!stopFetchingForAgent) {
            const response = await client.getAgentLogs(agent.name, null, page, limit, 'Generating chat');
            const logs = response.data || [];

            if (!logs || logs.length === 0) break;

            for (const log of logs) {
                const logTime = new Date(log.timestamp);

                if (logTime < SYNC_START_DATE) {
                    stopFetchingForAgent = true;
                    break;
                }

                const msg = log.log || '';
                if (!msg.includes('context [')) continue;

                const sessionId = extractSessionId(msg);
                if (!sessionId) continue;

                const isUniversal = msg.includes('universal context');
                const current = sessionContexts.get(sessionId);

                if (!current) {
                    sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                } else {
                    if (isUniversal && !current.isUniversal) {
                        sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                    } else if (isUniversal === current.isUniversal && logTime > current.time) {
                        sessionContexts.set(sessionId, { log: msg, time: logTime, isUniversal });
                    }
                }
            }

            if (stopFetchingForAgent) {
                logger.info(`    Reached logs older than ${SYNC_START_DATE.toISOString()}. Stopping fetch for ${agent.name}.`);
                break;
            }

            if (!response.hasMore || logs.length < limit) break;
            page++;
            await client.delay(50);
        }

        for (const [sessionId, { log: contextLog, time }] of sessionContexts) {
            try {
                const turns = parseContextLog(contextLog);
                if (turns.length === 0) continue;

                const existing = await Conversation.findOne({ session_id: sessionId });
                if (existing && existing.turns.length === turns.length && existing.last_message_at >= time) {
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
                logger.error(`Error syncing session ${sessionId}: ${e.message}`);
            }
        }
    }

    if (totalSynced > 0) {
        logger.info(`✅ Synced ${totalSynced} updated conversations`);
    }
}

async function runSyncCycle() {
    logger.info(`🔄 Sync Cycle Started at ${new Date().toISOString()}`);
    try {
        const client = new PipecatClient();
        const agents = await syncAgents(client);
        await syncSessions(client, agents);
        await syncConversations(client, agents);
    } catch (e) {
        logger.error('Sync Cycle Failed:', e);
    }
    logger.info(`🏁 Sync Cycle Finished. Next run in ${POLL_INTERVAL_MS / 1000}s`);
}

async function main() {
    logger.info('🚀 Starting Realtime Dashboard Sync Service (FINAL)');
    logger.info(`📅 Filtering data from: ${SYNC_START_DATE.toISOString()}`);

    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
    logger.info('✅ MongoDB connected');

    await runSyncCycle();
    setInterval(runSyncCycle, POLL_INTERVAL_MS);
}

process.on('SIGINT', async () => {
    logger.info('🛑 Stopping sync service...');
    await mongoose.disconnect();
    process.exit(0);
});

main();
