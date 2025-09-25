const mysql = require("mysql2/promise");
const logger = require("../utils/Logger");
const config = require("../utils/ConfigManager");

/**
 * Enhanced Database Service with proper connection handling and error management
 */
class DatabaseService {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection pool
     */
    async initialize() {
        try {
            const dbConfig = config.get('database');
            
            this.pool = mysql.createPool({
                host: dbConfig.hostname,
                port: dbConfig.port,
                user: dbConfig.login,
                password: dbConfig.password,
                database: dbConfig.dbname,
                waitForConnections: true,
                connectionLimit: dbConfig.connectionLimit,
                maxIdle: dbConfig.maxIdle,
                idleTimeout: dbConfig.idleTimeout,
                queueLimit: 0,
                enableKeepAlive: true,
                keepAliveInitialDelay: 0
            });

            // Test connection
            await this.testConnection();
            this.isConnected = true;
            logger.success("Database connection pool initialized successfully");

        } catch (error) {
            logger.error("Failed to initialize database connection", error);
            throw error;
        }
    }

    /**
     * Test database connection
     */
    async testConnection() {
        if (!this.pool) throw new Error("Pool not initialized");
        
        const connection = await this.pool.getConnection();
        try {
            await connection.ping();
            logger.info("Database connection test successful");
        } finally {
            connection.release();
        }
    }

    /**
     * Execute query with error handling and retries
     */
    async query(sql, params = [], retries = 3) {
        if (!this.isConnected || !this.pool) {
            throw new Error("Database not initialized");
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const [results] = await this.pool.execute(sql, params);
                return results;
            } catch (error) {
                logger.warn(`Query attempt ${attempt} failed: ${error.message}`);
                
                if (attempt === retries) {
                    logger.error(`Query failed after ${retries} attempts`, error);
                    throw error;
                }
                
                // Wait before retry
                await this.delay(1000 * attempt);
            }
        }
    }

    /**
     * Execute transaction
     */
    async transaction(queries) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const results = [];
            for (const { sql, params } of queries) {
                const [result] = await connection.execute(sql, params || []);
                results.push(result);
            }
            
            await connection.commit();
            return results;
        } catch (error) {
            await connection.rollback();
            logger.error("Transaction failed, rolled back", error, "Database");
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Configuration methods
    async setConfigValue(key, value) {
        const timestamp = Math.floor(Date.now() / 1000);
        await this.query(
            "INSERT INTO config (`key`, `value`, `timestamp`) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE `value`=?, `timestamp`=?",
            [key, value, timestamp, value, timestamp]
        );
        logger.debug(`Config value set: ${key}`, "Database");
    }

    async getConfigValue(key, expiration = 0) {
        const tsValid = expiration > 0 ? Math.floor(Date.now() / 1000) - expiration : 0;
        const results = await this.query(
            "SELECT * FROM config WHERE `key`=? AND `timestamp` >= ?",
            [key, tsValid]
        );
        return results;
    }

    // User management methods
    async saveUserModeus(telegramId, modeusProfileId) {
        await this.query(
            "INSERT INTO students (`telegram_id`, `attendee_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `attendee_id`=?",
            [telegramId, modeusProfileId, modeusProfileId]
        );
        logger.info(`Saved Modeus profile ${modeusProfileId} for user ${telegramId}`, "Database");
    }

    async saveUserGoogleCalendar(telegramId, googleToken) {
        await this.query(
            "INSERT INTO students (`telegram_id`, `google_token`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `google_token`=?",
            [telegramId, googleToken, googleToken]
        );
        logger.info(`Saved Google token for user ${telegramId}`, "Database");
    }

    async getUserInfo(telegramId) {
        return await this.query(
            "SELECT * FROM students WHERE `telegram_id`=?",
            [telegramId]
        );
    }

    async findAttendee(attendeeId) {
        return await this.query(
            "SELECT * FROM students WHERE `attendee_id`=?",
            [attendeeId]
        );
    }

    // Google auth methods
    async getGoogleLoginAttempts() {
        return await this.query(
            "SELECT `code`, `tg_id` FROM google_auth GROUP BY `tg_id`"
        );
    }

    async deleteLoginAttempts(telegramId) {
        await this.query(
            "DELETE FROM google_auth WHERE `tg_id`=?",
            [telegramId]
        );
    }

    async saveCalendarID(telegramId, calendarId) {
        await this.query(
            "INSERT INTO students (`telegram_id`, `calendar_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?",
            [telegramId, calendarId, calendarId]
        );
        logger.info(`Saved calendar ID for user ${telegramId}`, "Database");
    }

    // Event management methods
    async saveEvent(eventId, lastCheck, timestamp, eventData) {
        await this.query(
            "INSERT INTO events (`id`, `last_check`, `timestamp`, `event_data`) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE `last_check`=?, `event_data`=?",
            [eventId, lastCheck, timestamp, eventData, lastCheck, eventData]
        );
    }

    async saveUserEvent(uniqueId, attendeeId, eventId, lastCheck, timestamp) {
        await this.query(
            "INSERT INTO student_events (`unique_id`, `attendee_id`, `event_id`, `last_check`, `timestamp`) VALUES(?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `last_check`=?",
            [uniqueId, attendeeId, eventId, lastCheck, timestamp, lastCheck]
        );
    }

    async getEvent(eventId) {
        return await this.query(
            "SELECT * FROM events WHERE `id`=?",
            [eventId]
        );
    }

    async getUserEvents(attendeeId) {
        return await this.query(
            "SELECT * FROM student_events WHERE `attendee_id`=?",
            [attendeeId]
        );
    }

    async getRecheckUsers() {
        return await this.query(
            "SELECT DISTINCT `attendee_id` FROM students WHERE `attendee_id` IS NOT NULL"
        );
    }

    async getLoggedAttendees() {
        return await this.query(
            "SELECT DISTINCT `attendee_id` FROM students WHERE `attendee_id` IS NOT NULL AND `google_token` IS NOT NULL"
        );
    }

    // Calendar event methods
    async saveCalendarEvent(uniqueId, calendarId, timestamp, eventTimestamp) {
        await this.query(
            "INSERT INTO calendar_events (`unique_id`, `calendar_id`, `timestamp`, `event_timestamp`) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?, `timestamp`=?",
            [uniqueId, calendarId, timestamp, eventTimestamp, calendarId, timestamp]
        );
    }

    async findCalendarEvent(uniqueId) {
        return await this.query(
            "SELECT * FROM calendar_events WHERE `unique_id`=?",
            [uniqueId]
        );
    }

    async deleteCalendarEvent(uniqueId) {
        await this.query(
            "DELETE FROM calendar_events WHERE `unique_id`=?",
            [uniqueId]
        );
    }

    async removeCalendarEvents() {
        await this.query("DELETE FROM calendar_events");
        logger.info("All calendar events removed", "Database");
    }

    // Cleanup methods
    async cleanupOldEvents(mondayTimestamp, lastCheck) {
        const result = await this.query(
            "DELETE FROM events WHERE `timestamp` < ? AND `last_check` != ?",
            [mondayTimestamp, lastCheck]
        );
        logger.info(`Cleaned up ${result.affectedRows} old events`, "Database");
    }

    async cleanupOldStudentEvents(mondayTimestamp, lastCheck) {
        const result = await this.query(
            "DELETE FROM student_events WHERE `timestamp` < ? AND `last_check` != ?",
            [mondayTimestamp, lastCheck]
        );
        logger.info(`Cleaned up ${result.affectedRows} old student events`, "Database");
    }

    /**
     * Gracefully close database connections
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            logger.info("Database connections closed", "Database");
        }
    }
}

module.exports = DatabaseService;