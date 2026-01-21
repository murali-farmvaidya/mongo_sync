const path = require('path');
const { sequelize } = require(path.join(__dirname, './src/config/database'));
const { DataTypes } = require('sequelize');

async function diagnostic() {
    try {
        console.log('--- Database Diagnostic ---');

        // Check connection
        await sequelize.authenticate();
        console.log('Connection: OK');

        // Check tables
        const [tables] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables found:', tables.map(t => t.table_name).join(', '));

        for (const table of tables) {
            const tableName = table.table_name;
            const [columns] = await sequelize.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}'`);
            console.log(`\nTable: ${tableName}`);
            console.table(columns);

            const [count] = await sequelize.query(`SELECT COUNT(*) FROM "${tableName}"`);
            console.log(`Count: ${count[0].count}`);
        }

    } catch (error) {
        console.error('Diagnostic failed:', error);
    } finally {
        await sequelize.close();
    }
}

diagnostic();
