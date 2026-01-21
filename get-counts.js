const path = require('path');
const { sequelize } = require(path.join(__dirname, './src/config/database'));

async function getCounts() {
    try {
        const [agents] = await sequelize.query('SELECT COUNT(*) FROM "Agents"');
        const [agentNames] = await sequelize.query('SELECT name FROM "Agents" ORDER BY name');
        const [sessions] = await sequelize.query('SELECT COUNT(*) FROM "Sessions"');
        const [conversations] = await sequelize.query('SELECT COUNT(*) FROM "Conversations"');

        console.log(`Agents: ${agents[0].count}`);
        console.log(`Agent Names: ${agentNames.map(a => a.name).join(', ')}`);
        console.log(`Sessions: ${sessions[0].count}`);
        console.log(`Conversations: ${conversations[0].count}`);

        if (parseInt(conversations[0].count) > 0) {
            const [sample] = await sequelize.query('SELECT session_id, agent_name, total_turns FROM "Conversations" LIMIT 1');
            console.log('Sample Conversation:', sample[0]);
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await sequelize.close();
    }
}

getCounts();
