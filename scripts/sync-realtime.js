/**
 * Realtime Dashboard Data Sync - OPTIMIZED & ROBUST (PostgreSQL Version)
 * 
 * Features:
 * 1. Syncs Agents, Sessions, and CLEAN Conversations (Q&A pairs only)
 * 2. Filters for data from January 1, 2026 onwards
 * 3. OPTIMIZED: Stops fetching logs once it hits data older than start date
 * 4. ROBUST CLEANING: Handles messy system prompts and escaped characters
 * 5. POSTGRESQL: Stores data in relational tables with JSONB support
 */

const path = require('path');
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize, testConnection } = require(path.join(__dirname, '../src/config/database'));
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// ============ CONFIGURATION ============
const SYNC_START_DATE = new Date('2026-01-01T00:00:00Z');
const POLL_INTERVAL_MS = 60000; // Run every 60 seconds

// ============ MODELS (Sequelize) ============

const Agent = sequelize.define('Agent', {
    agent_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Timestamps created_at/updated_at are handled automatically by Sequelize
    session_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'Agents',
    timestamps: true,
    underscored: true // Use snake_case for DB columns (created_at)
});

const Session = sequelize.define('Session', {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    agent_id: DataTypes.STRING,
    agent_name: DataTypes.STRING,
    started_at: DataTypes.DATE,
    ended_at: DataTypes.DATE,
    status: DataTypes.STRING,
    bot_start_seconds: {
        type: DataTypes.FLOAT, // Float for seconds
        defaultValue: 0
    },
    cold_start: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    duration_seconds: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    conversation_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'Sessions',
    timestamps: true,
    underscored: true
});

const Conversation = sequelize.define('Conversation', {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true, // 1-to-1 mapping roughly for this sync logic
        allowNull: false
    },
    agent_id: DataTypes.STRING,
    agent_name: DataTypes.STRING,
    turns: {
        type: DataTypes.JSONB, // Stores the array of objects perfectly
        defaultValue: []
    },
    total_turns: DataTypes.INTEGER,
    first_message_at: DataTypes.DATE,
    last_message_at: DataTypes.DATE,
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'Conversations',
    timestamps: true,
    underscored: true
});

// Relationships (Optional but good for future expansion)
Agent.hasMany(Session, { foreignKey: 'agent_id' });
Session.belongsTo(Agent, { foreignKey: 'agent_id' });
Conversation.belongsTo(Session, { foreignKey: 'session_id' });

// ============ PARSING HELPERS ============

function extractSessionId(logMessage) {
    const match = logMessage.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

function cleanUserMessage(msg) {
    if (!msg) return msg;
    if (msg.includes('[KNOWLEDGE BASE CONTEXT]')) {
        let cleaned = msg.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?```json[\s\S]*?```\s*/, '');
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            cleaned = cleaned.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?\\`\\`\\`json[\s\S]*?\\`\\`\\`\s*/, '');
        }
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            const parts = cleaned.split('\n');
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

        let contentStart = arrayContent.indexOf("'content': '", nextMsgPos);
        let quoteChar = "'";

        const doubleQuoteStart = arrayContent.indexOf("'content': \"", nextMsgPos);

        if (contentStart === -1 || (doubleQuoteStart !== -1 && doubleQuoteStart < contentStart)) {
            contentStart = doubleQuoteStart;
            quoteChar = '"';
        }

        if (contentStart === -1) {
            pos = nextMsgPos + 10;
            continue;
        }

        const contentValueStart = contentStart + ` 'content': ${quoteChar}`.length - 1;

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

// ============ SYNC FUNCTIONS (PostgreSQL) ============

async function syncAgents(client) {
    const agents = await client.getAllAgents();
    for (const agent of agents) {
        // Sequelize upsert
        await Agent.upsert({
            agent_id: agent.id,
            name: agent.name,
            last_synced: new Date()
            // session_count: updated via logic elsewhere or defaults
        });
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

            // Sequelize Upsert
            await Session.upsert({
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
            });
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

                // Check existing logic (optimized query)
                const existing = await Conversation.findOne({ where: { session_id: sessionId } });
                if (existing && existing.turns.length === turns.length && existing.last_message_at >= time) {
                    continue;
                }

                // Verify Session exists to prevent Foreign Key Violation
                // (Cases where session started in 2025 but logs in 2026)
                const parentSession = await Session.findOne({ where: { session_id: sessionId } });
                if (!parentSession) {
                    // logger.warn(`Skipping conversation for session ${sessionId} (Session not found/skipped due to date filter)`);
                    continue;
                }

                await Conversation.upsert({
                    session_id: sessionId,
                    agent_id: agent.id,
                    agent_name: agent.name,
                    turns: turns, // Sequelize handles JSONB serialization
                    total_turns: turns.length,
                    first_message_at: turns[0]?.timestamp || time,
                    last_message_at: time,
                    last_synced: new Date()
                });

                // Update session count
                await Session.update(
                    { conversation_count: turns.length },
                    { where: { session_id: sessionId } }
                );

                // Update agent session count - tricky in SQL, maybe just count rows?
                // For now, let's just increment or better yet, recalculate periodically.
                // Or just update the Agent record if we were tracking it there explicitly.
                // We'll skip complex count updates for now to keep it fast, rely on SQL queries for counts.

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
    logger.info('🚀 Starting Realtime Dashboard Sync Service (PostgreSQL)');
    logger.info(`📅 Filtering data from: ${SYNC_START_DATE.toISOString()}`);

    try {
        await testConnection();
        // Sync Models (Create Tables if not exist)
        logger.info('🏗️  Verifying database creation (Auto-Sync)...');
        await sequelize.sync({ alter: true }); // uses ALTER TABLE to match model
        logger.info('✅ Database structure is ready.');

        await runSyncCycle();
        // Use recursive setTimeout loop to prevent overlap, cleaner than interval
        const loop = async () => {
            setTimeout(async () => {
                await runSyncCycle();
                loop();
            }, POLL_INTERVAL_MS);
        }
        loop();

    } catch (e) {
        logger.error('Fatal Startup Error:', e);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    logger.info('🛑 Stopping sync service...');
    await sequelize.close();
    process.exit(0);
});

main();
