require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });

    const count = await mongoose.connection.db.collection('logs').countDocuments();
    console.log('Total logs in DB:', count);

    const samples = await mongoose.connection.db.collection('logs').find({}).limit(5).toArray();
    console.log('\nSample logs:');
    samples.forEach((s, i) => {
        console.log(`[${i}] type: ${s.data?.type || 'N/A'}`);
        console.log(`    message: ${(s.message || '').substring(0, 80)}...`);
    });

    await mongoose.disconnect();
}

check();
