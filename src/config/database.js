require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

const logger = require(path.join(__dirname, '../utils/logger'));

logger.info(`🔌 Connecting to PostgreSQL at ${process.env.POSTGRES_HOST}...`);

const sequelize = new Sequelize(
    process.env.POSTGRES_DB,
    process.env.POSTGRES_USER,
    process.env.POSTGRES_PASSWORD,
    {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT || 5432,
        dialect: 'postgres',
        logging: false, // Set to console.log to see raw SQL
        dialectOptions: process.env.POSTGRES_SSL === 'true' ? {
            ssl: {
                require: true,
                rejectUnauthorized: false
            },
            keepAlive: true // IMPORTANT: Keeps Azure connection open
        } : {},
        pool: {
            max: 5,
            min: 0,
            acquire: 60000,
            idle: 5000, // Close idle connections faster than Azure's 10-min timeout
            evict: 1000 // Often check for idle connections
        }
    }
);

// Test connection function
async function testConnection() {
    try {
        await sequelize.authenticate();
        logger.info('✅ PostgreSQL Connection has been established successfully.');
    } catch (error) {
        logger.error('❌ Unable to connect to the database:', error);
    }
}

module.exports = { sequelize, testConnection };
