const logger = require("../utils/Logger");
const config = require("../utils/ConfigManager");

/**
 * Service for managing synchronization between Modeus and Google Calendar
 */
class SyncService {
    constructor(database, modeusService, googleService) {
        this.database = database;
        this.modeusService = modeusService;
        this.googleService = googleService;
        this.appConfig = config.get('app');
        
        this.isRunning = false;
        this.syncInterval = null;
    }

    /**
     * Initialize and start sync service
     */
    async initialize() {
        try {
            // Verify Modeus connectivity
            await this.modeusService.getToken();
            logger.success("Modeus connection verified");

            // Start periodic sync
            this.startPeriodicSync();
            
            // Run initial sync
            await this.runSync();

        } catch (error) {
            logger.error("Failed to initialize sync service", error);
            throw error;
        }
    }

    /**
     * Start periodic sync timer
     */
    startPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(() => {
            this.runSync().catch(error => {
                logger.error("Scheduled sync failed", error);
            });
        }, this.appConfig.sync_interval);

        logger.info(`Periodic sync started with interval: ${this.appConfig.sync_interval / 1000 / 60} minutes`);
    }

    /**
     * Run complete synchronization process
     */
    async runSync() {
        if (this.isRunning) {
            logger.warn("Sync already running, skipping this cycle");
            return;
        }

        this.isRunning = true;
        const syncStartTime = Math.floor(Date.now() / 1000);

        try {
            logger.info("Starting synchronization cycle");

            // Phase 1: Sync Modeus events
            const stats = await this.syncModeusEvents(syncStartTime);
            
            // Phase 2: Update last refresh timestamp
            await this.database.setConfigValue("lastRefresh", syncStartTime);
            
            // Phase 3: Cleanup old events
            await this.cleanupOldEvents(syncStartTime);
            
            // Phase 4: Sync with Google Calendar
            await this.syncGoogleCalendar();
            
            // Phase 5: Process pending Google auth attempts
            await this.processGoogleAuth();

            const totalTime = Math.floor(Date.now() / 1000) - syncStartTime;
            logger.success(`Synchronization completed in ${totalTime} seconds. Stats: ${JSON.stringify(stats)}`);

        } catch (error) {
            logger.error("Synchronization failed", error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Sync Modeus events for all users
     */
    async syncModeusEvents(syncStartTime) {
        logger.info("Syncing Modeus events");
        
        const stats = { students: 0, events: 0, batches: 0 };
        const batchSize = this.appConfig.batch_size;
        
        try {
            const allStudents = await this.database.getRecheckUsers();
            
            // Process students in batches
            const studentBatches = this.chunkArray(allStudents, batchSize);
            stats.batches = studentBatches.length;

            for (const batch of studentBatches) {
                const attendeeIds = batch.map(student => student.attendee_id);
                const events = await this.modeusService.findEvents(attendeeIds);
                
                stats.students += batch.length;
                stats.events += events.length;

                // Save events in parallel
                await this.saveEventsBatch(events, attendeeIds, syncStartTime);
                
                // Add small delay between batches to avoid overwhelming the API
                if (studentBatches.length > 1) {
                    await this.delay(1000);
                }
            }

        } catch (error) {
            logger.error("Error syncing Modeus events", error);
            throw error;
        }

        return stats;
    }

    /**
     * Save events batch to database
     */
    async saveEventsBatch(events, attendeeIds, syncStartTime) {
        const savePromises = [];

        for (const event of events) {
            const eventTimestamp = Math.floor(new Date(event.info.startsAt).getTime() / 1000);
            const eventObject = this.buildEventObject(event);

            // Save main event
            savePromises.push(
                this.database.saveEvent(
                    event.info.id,
                    syncStartTime,
                    eventTimestamp,
                    JSON.stringify(eventObject)
                )
            );

            // Save user-event relationships
            for (const attendeeId of attendeeIds) {
                if (!eventObject.attendees.includes(attendeeId)) continue;
                
                savePromises.push(
                    this.database.saveUserEvent(
                        `${attendeeId};${event.info.id}`,
                        attendeeId,
                        event.info.id,
                        syncStartTime,
                        eventTimestamp
                    )
                );
            }
        }

        // Execute all saves in parallel
        const results = await Promise.allSettled(savePromises);
        
        // Log any failures
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length > 0) {
            logger.warn(`${failures.length} database saves failed during batch processing`);
        }
    }

    /**
     * Build event object for database storage
     */
    buildEventObject(event) {
        return {
            id: event.info.id,
            name: event.info.name,
            typeId: event.info.typeId,
            start: event.info.startsAt,
            end: event.info.endsAt,
            room: event.room_name,
            course: event.course,
            attendees: event.attendee_list,
            teachers: event.teachers,
        };
    }

    /**
     * Clean up old events from database
     */
    async cleanupOldEvents(syncStartTime) {
        try {
            const dates = this.modeusService.getDateRange();
            const mondayTimestamp = Math.floor(dates.start_timestamp / 1000);

            await Promise.all([
                this.database.cleanupOldEvents(mondayTimestamp, syncStartTime),
                this.database.cleanupOldStudentEvents(mondayTimestamp, syncStartTime)
            ]);

            logger.info("Old events cleanup completed");

        } catch (error) {
            logger.error("Error during cleanup", error);
        }
    }

    /**
     * Sync with Google Calendar
     */
    async syncGoogleCalendar() {
        try {
            logger.info("Starting Google Calendar sync");
            await this.googleService.syncAllUsers();
            logger.success("Google Calendar sync completed");

        } catch (error) {
            logger.error("Google Calendar sync failed", error);
        }
    }

    /**
     * Process pending Google authentication attempts
     */
    async processGoogleAuth() {
        try {
            await this.googleService.processLoginAttempts();
        } catch (error) {
            logger.error("Error processing Google auth attempts", error);
        }
    }

    /**
     * Manual sync trigger (for admin commands)
     */
    async triggerManualSync() {
        logger.info("Manual sync triggered");
        await this.runSync();
    }

    /**
     * Get sync statistics
     */
    async getSyncStats() {
        try {
            const lastRefresh = await this.database.getConfigValue("lastRefresh");
            const userCount = await this.database.getRecheckUsers();
            const loggedUsers = await this.database.getLoggedAttendees();

            return {
                lastSync: lastRefresh.length > 0 ? new Date(lastRefresh[0].value * 1000) : null,
                totalUsers: userCount.length,
                loggedUsers: loggedUsers.length,
                isRunning: this.isRunning,
                syncInterval: this.appConfig.sync_interval / 1000 / 60 // in minutes
            };

        } catch (error) {
            logger.error("Error getting sync stats", error);
            return null;
        }
    }

    /**
     * Stop sync service
     */
    stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        
        logger.info("Sync service stopped");
    }

    /**
     * Utility functions
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SyncService;