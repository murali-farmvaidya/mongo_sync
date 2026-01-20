/**
 * Inspect conversations in MongoDB
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function inspect() {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });

    const count = await mongoose.connection.db.collection('conversations').countDocuments();
    console.log(`Total conversations: ${count}`);

    const samples = await mongoose.connection.db.collection('conversations').find({}).sort({ last_synced: -1 }).limit(3).toArray();

    console.log('\n--- SAMPLE CONVERSATIONS ---');
    for (const s of samples) {
        console.log(`Session: ${s.session_id}`);
        console.log(`Agent: ${s.agent_name}`);
        console.log(`Turns: ${s.turns.length}`);

        s.turns.slice(0, 3).forEach(t => {
            console.log(`  [Turn ${t.turn_id}]`);
            console.log(`    User: "${(t.user_message || '').substring(0, 100).replace(/\n/g, ' ')}"`);
            console.log(`    Asst: "${(t.assistant_message || '').substring(0, 100).replace(/\n/g, ' ')}"`);
        });
        console.log('');
    }

    await mongoose.disconnect();
}

inspect().catch(console.error);
