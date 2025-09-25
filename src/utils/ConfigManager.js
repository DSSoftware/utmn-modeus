require("dotenv").config();
const logger = require('./Logger');

/**
 * Configuration manager with validation
 */
class ConfigManager {
    constructor() {
        this.config = this.loadConfig();
        this.validateConfig();
    }

    /**
     * Load configuration from environment variables
     */
    loadConfig() {
        return {
            credentials: {
                internal: process.env.INTERNAL_TOKEN,
                telegram: process.env.TELEGRAM_TOKEN,
                utmn: {
                    login: process.env.UTMN_LOGIN,
                    password: process.env.UTMN_PASSWORD
                }
            },
            database: {
                hostname: process.env.DB_HOSTNAME || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                login: process.env.DB_LOGIN,
                password: process.env.DB_PASSWORD,
                dbname: process.env.DB_NAME,
                connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
                maxIdle: parseInt(process.env.DB_MAX_IDLE) || 10,
                idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT) || 60000
            },
            google: {
                client_id: process.env.GOOGLE_CLIENT_ID,
                secret_id: process.env.GOOGLE_SECRET_ID,
                redirect: process.env.GOOGLE_REDIRECT
            },
            app: {
                admin_id: process.env.ADMIN_ID,
                log_level: process.env.LOG_LEVEL || 'info',
                sync_interval: parseInt(process.env.SYNC_INTERVAL) || 15 * 60 * 1000, // 15 minutes
                batch_size: parseInt(process.env.BATCH_SIZE) || 10,
                google_batch_limit: parseInt(process.env.GOOGLE_BATCH_LIMIT) || 50,
                max_retries: parseInt(process.env.MAX_RETRIES) || 5,
                retry_delay: parseInt(process.env.RETRY_DELAY) || 1000,
                threads_count: parseInt(process.env.THREADS_COUNT) || 5
            },
            modeus: {
                base_url: 'https://utmn.modeus.org',
                auth_url: 'https://auth.modeus.org',
                fs_url: 'https://fs.utmn.ru',
                timezone: 'Asia/Tyumen'
            }
        };
    }

    /**
     * Validate required configuration
     */
    validateConfig() {
        const required = [
            'credentials.telegram',
            'credentials.utmn.login',
            'credentials.utmn.password',
            'database.hostname',
            'database.login',
            'database.password',
            'database.dbname',
            'google.client_id',
            'google.secret_id',
            'google.redirect'
        ];

        const missing = [];
        
        for (const path of required) {
            if (!this.getNestedValue(this.config, path)) {
                missing.push(path);
            }
        }

        if (missing.length > 0) {
            const error = `Missing required configuration: ${missing.join(', ')}`;
            logger.error(error, null, 'Config');
            throw new Error(error);
        }

        logger.success('Configuration validated successfully', 'Config');
    }

    /**
     * Get nested value from object by path
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    /**
     * Get configuration value
     */
    get(path) {
        return this.getNestedValue(this.config, path) || this.config;
    }

    /**
     * Get full configuration
     */
    getAll() {
        return this.config;
    }
}

module.exports = new ConfigManager();