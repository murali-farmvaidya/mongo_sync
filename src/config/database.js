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
                rejectUnauthorized: false // Azure flexible server often uses self-signed or internal certs
            }
        } : {},
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
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
