const path = require('path');
const { sequelize } = require(path.join(__dirname, './src/config/database'));
const { DataTypes } = require('sequelize');

async function checkData() {
    try {
        console.log('Checking database tables...');

        // Define models locally for quick check
        const Agent = sequelize.define('Agent', { agent_id: { type: DataTypes.STRING, primaryKey: true }, name: DataTypes.STRING }, { tableName: 'Agents' });
        const Session = sequelize.define('Session', { session_id: { type: DataTypes.STRING, primaryKey: true }, agent_id: DataTypes.STRING }, { tableName: 'Sessions' });
        const Conversation = sequelize.define('Conversation', { session_id: { type: DataTypes.STRING, primaryKey: true }, total_turns: DataTypes.INTEGER }, { tableName: 'Conversations' });

        const agentsCount = await Agent.count();
        const sessionsCount = await Session.count();
        const convCount = await Conversation.count();

        console.log(`Agents in DB: ${agentsCount}`);
        console.log(`Sessions in DB: ${sessionsCount}`);
        console.log(`Conversations in DB: ${convCount}`);

        if (convCount > 0) {
            const conv = await Conversation.findOne();
            console.log('\nSample Conversation data:');
            console.log(JSON.stringify(conv, null, 2));
        }

    } catch (error) {
        console.error('Error checking database:', error);
    } finally {
        await sequelize.close();
    }
}

checkData();
