const logger = require("./src/utils/Logger");
const config = require("./src/utils/ConfigManager");
const DatabaseService = require("./src/services/DatabaseService");
const ModeusService = require("./src/services/ModeusService");
const GoogleCalendarService = require("./src/services/GoogleCalendarService");
const TelegramBotService = require("./src/services/TelegramBotService");
const SyncService = require("./src/services/SyncService");

/**
 * Main Application Class
 * Orchestrates all services and manages application lifecycle
 */
class Application {
    constructor() {
        this.services = {};
        this.isShuttingDown = false;
    }

    /**
     * Initialize and start the application
     */
    async start() {
        try {
            logger.info("Starting UTMN-Modeus application...");
            
            // Initialize services in dependency order
            await this.initializeServices();
            
            // Start services
            await this.startServices();
            
            // Setup graceful shutdown
            this.setupGracefulShutdown();
            
            logger.success("UTMN-Modeus application started successfully");
            
        } catch (error) {
            logger.error("Failed to start application", error);
            process.exit(1);
        }
    }

    /**
     * Initialize all services
     */
    async initializeServices() {
        logger.info("Initializing services...");

        try {
            // 1. Database Service (foundation)
            logger.info("Initializing Database Service...");
            this.services.database = new DatabaseService();
            await this.services.database.initialize();

            // 2. Modeus Service (depends on database)
            logger.info("Initializing Modeus Service...");
            this.services.modeus = new ModeusService(this.services.database);

            // 3. Google Calendar Service (depends on database)
            logger.info("Initializing Google Calendar Service...");
            this.services.google = new GoogleCalendarService(this.services.database);

            // 4. Telegram Bot Service (depends on database, modeus, google)
            logger.info("Initializing Telegram Bot Service...");
            this.services.telegram = new TelegramBotService(
                this.services.database,
                this.services.modeus,
                this.services.google
            );

            // 5. Sync Service (depends on all above services)
            logger.info("Initializing Sync Service...");
            this.services.sync = new SyncService(
                this.services.database,
                this.services.modeus,
                this.services.google
            );

            // Wire up cross-service dependencies
            this.wireServices();

            logger.success("All services initialized successfully");

        } catch (error) {
            logger.error("Service initialization failed", error);
            throw error;
        }
    }

    /**
     * Wire up cross-service dependencies
     */
    wireServices() {
        // Allow Google service to send Telegram messages
        if (this.services.google && this.services.telegram) {
            this.services.google.sendTelegramMessage = (telegramId, message) =>
                this.services.telegram.sendMessage(telegramId, message);
        }

        // Allow Telegram bot to trigger manual syncs
        if (this.services.telegram && this.services.sync) {
            this.services.telegram.triggerManualSync = () =>
                this.services.sync.triggerManualSync();
        }

        logger.info("Cross-service dependencies wired successfully");
    }

    /**
     * Start all services
     */
    async startServices() {
        logger.info("Starting services...");

        try {
            // Start Telegram bot
            await this.services.telegram.start();

            // Initialize sync service (will start periodic sync)
            await this.services.sync.initialize();

            logger.success("All services started successfully");

        } catch (error) {
            logger.error("Service startup failed", error);
            throw error;
        }
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupGracefulShutdown() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

        signals.forEach(signal => {
            process.on(signal, () => {
                logger.info(`${signal} received, initiating graceful shutdown...`);
                this.gracefulShutdown(signal);
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception', error);
            this.gracefulShutdown('uncaughtException');
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection', { reason, promise });
            this.gracefulShutdown('unhandledRejection');
        });

        logger.info("Graceful shutdown handlers registered");
    }

    /**
     * Perform graceful shutdown
     */
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) {
            logger.warn("Shutdown already in progress, forcing exit...");
            process.exit(1);
        }

        this.isShuttingDown = true;
        logger.info("Starting graceful shutdown...");

        try {
            // Stop services in reverse order
            const shutdownTimeout = setTimeout(() => {
                logger.error("Graceful shutdown timeout exceeded, forcing exit");
                process.exit(1);
            }, 30000); // 30 second timeout

            // Stop sync service
            if (this.services.sync) {
                logger.info("Stopping sync service...");
                this.services.sync.stop();
            }

            // Stop Telegram bot
            if (this.services.telegram) {
                logger.info("Stopping Telegram bot...");
                this.services.telegram.stop(signal);
            }

            // Close database connections
            if (this.services.database) {
                logger.info("Closing database connections...");
                await this.services.database.close();
            }

            clearTimeout(shutdownTimeout);
            logger.success("Graceful shutdown completed");
            process.exit(0);

        } catch (error) {
            logger.error("Error during graceful shutdown", error);
            process.exit(1);
        }
    }

    /**
     * Get application health status
     */
    async getHealthStatus() {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {},
            config: {
                environment: process.env.NODE_ENV || 'development',
                version: require('./package.json').version
            }
        };

        try {
            // Check database
            if (this.services.database?.isConnected) {
                health.services.database = 'healthy';
            } else {
                health.services.database = 'unhealthy';
                health.status = 'unhealthy';
            }

            // Check sync service
            const syncStats = await this.services.sync?.getSyncStats();
            if (syncStats) {
                health.services.sync = {
                    status: 'healthy',
                    lastSync: syncStats.lastSync,
                    isRunning: syncStats.isRunning,
                    users: {
                        total: syncStats.totalUsers,
                        logged: syncStats.loggedUsers
                    }
                };
            } else {
                health.services.sync = 'unhealthy';
                health.status = 'unhealthy';
            }

            // Add other service checks as needed
            health.services.telegram = 'healthy'; // Assume healthy if no errors
            health.services.modeus = 'healthy';
            health.services.google = 'healthy';

        } catch (error) {
            logger.error("Error getting health status", error);
            health.status = 'unhealthy';
            health.error = error.message;
        }

        return health;
    }

    /**
     * Get application statistics
     */
    async getStats() {
        try {
            const syncStats = await this.services.sync?.getSyncStats();
            const appConfig = config.getAll();

            return {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                sync: syncStats,
                config: {
                    syncInterval: appConfig.app.sync_interval / 1000 / 60, // in minutes
                    batchSize: appConfig.app.batch_size,
                    threads: appConfig.app.threads_count
                }
            };

        } catch (error) {
            logger.error("Error getting application stats", error);
            return { error: error.message };
        }
    }
}

/**
 * Application entry point
 */
async function main() {
    const app = new Application();
    await app.start();

    // Expose app instance for debugging/monitoring
    global.app = app;
}

// Start the application if this file is run directly
if (require.main === module) {
    main().catch((error) => {
        logger.error("Application startup failed", error);
        process.exit(1);
    });
}

module.exports = Application;