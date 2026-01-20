/**
 * Search for specific conversation
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function search() {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });

    const c = await mongoose.connection.db.collection('conversations').findOne({ 'turns.user_message': { $regex: 'biofactor', $options: 'i' } });

    if (c) {
        console.log('FOUND CONVERSATION!');
        console.log(`Session: ${c.session_id}`);
        console.log(`Agent: ${c.agent_name}`);
        console.log(JSON.stringify(c.turns, null, 2));
    } else {
        console.log('Not found yet. Sync might still be processing.');
    }

    await mongoose.disconnect();
}

search().catch(console.error);
