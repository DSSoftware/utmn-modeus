const { google } = require("googleapis");
const { RunBatch } = require("gbatchrequests");
const crypto = require("crypto");
const logger = require("../utils/Logger");
const config = require("../utils/ConfigManager");

/**
 * Service for Google Calendar integration with batch operations and parallel processing
 */
class GoogleCalendarService {
    constructor(database) {
        this.database = database;
        this.oauth = new google.auth.OAuth2(
            config.get('google.client_id'),
            config.get('google.secret_id'),
            config.get('google.redirect')
        );
        this.appConfig = config.get('app');
    }

    /**
     * Generate OAuth URL for user authorization
     */
    generateAuthUrl(telegramId) {
        const issueTime = Math.floor(Date.now() / 1000);
        const state = `${telegramId}-${issueTime}-${crypto.createHash('sha256').update(
            `${telegramId}-${issueTime}-${config.get('credentials.internal')}`
        ).digest('hex')}`;

        return this.oauth.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/calendar.app.created"],
            state: state,
            prompt: "consent",
        });
    }

    /**
     * Process Google login attempts
     */
    async processLoginAttempts() {
        try {
            const loginAttempts = await this.database.getGoogleLoginAttempts();
            if (loginAttempts.length === 0) return;

            logger.info(`Processing ${loginAttempts.length} Google login attempts`);

            const promises = loginAttempts.map(attempt => this.processLoginAttempt(attempt));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error("Error processing Google login attempts", error);
        }
    }

    /**
     * Process individual login attempt
     */
    async processLoginAttempt(attempt) {
        const { tg_id: telegramId, code } = attempt;
        
        try {
            const { tokens } = await this.oauth.getToken(code);
            await this.database.deleteLoginAttempts(telegramId);

            if (!tokens || !tokens.refresh_token) {
                logger.error(`Failed to get refresh_token for user ${telegramId}`);
                await this.sendTelegramMessage(
                    telegramId,
                    "❌ Не удалось привязать Google! Попробуй привязать ещё раз через /link_google.\nЕсли проблема повторяется, напиши @artem2584."
                );
                return;
            }

            await this.database.saveUserGoogleCalendar(telegramId, tokens.refresh_token);
            logger.success(`Successfully obtained refresh_token for user ${telegramId}`);
            
            await this.sendTelegramMessage(
                telegramId,
                "✅ Google Calendar был успешно привязан! Расписание начнет синхронизироваться в течение 15-30 минут."
            );

        } catch (error) {
            logger.error(`Error exchanging Google token for user ${telegramId}`, error);
            await this.database.deleteLoginAttempts(telegramId);
            
            let userMessage = `❌ Ошибка при привязке Google Calendar: ${error.message}.\nПопробуй еще раз через /link_google.`;
            if (error.message && (error.message.includes("invalid_grant") || error.message.includes("code has already been used"))) {
                userMessage = "❌ Ошибка: код авторизации уже использован или недействителен. Пожалуйста, сгенерируй новую ссылку через /link_google и используй ее сразу.";
            }
            
            await this.sendTelegramMessage(telegramId, userMessage + "\nЕсли не получится, напиши @artem2584.");
        }
    }

    /**
     * Sync all users with Google Calendar using parallel processing
     */
    async syncAllUsers() {
        try {
            logger.info("Starting Google Calendar sync for all users");
            const startTime = Math.floor(Date.now() / 1000);
            
            const loggedUsers = await this.database.getLoggedAttendees();
            if (loggedUsers.length === 0) {
                logger.info("No users to sync with Google Calendar");
                return;
            }

            logger.info(`Syncing ${loggedUsers.length} users with Google Calendar`);

            // Process users in parallel batches to avoid overwhelming the API
            const batchSize = Math.min(5, this.appConfig.google_batch_limit);
            for (let i = 0; i < loggedUsers.length; i += batchSize) {
                const userBatch = loggedUsers.slice(i, i + batchSize);
                const syncPromises = userBatch.map(user => this.syncUser(user, startTime));
                
                await Promise.allSettled(syncPromises);
                
                // Add delay between batches to respect rate limits
                if (i + batchSize < loggedUsers.length) {
                    await this.delay(2000);
                }
            }

            const totalTime = Math.floor(Date.now() / 1000) - startTime;
            logger.success(`Finished syncing all users with Google Calendar in ${totalTime} seconds`);

        } catch (error) {
            logger.error("Error during Google Calendar sync", error);
        }
    }

    /**
     * Sync individual user with Google Calendar
     */
    async syncUser(user, syncStartTime) {
        const userId = user.attendee_id;
        
        try {
            logger.info(`Starting sync for user ${userId}`);
            
            // Get user events from Modeus
            const modeusEvents = await this.database.getUserEvents(userId);
            if (modeusEvents.length === 0) {
                logger.info(`User ${userId}: No Modeus events to sync`);
                return;
            }

            // Get user details and setup OAuth
            const userDetails = await this.getUserDetails(userId);
            if (!userDetails) return;

            const { accessToken, calendarId } = await this.setupUserAuth(userDetails, userId);
            if (!accessToken || !calendarId) return;

            // Process events using batch operations
            await this.processUserEvents(userId, modeusEvents, accessToken, calendarId, syncStartTime);

            logger.success(`Completed sync for user ${userId}`);

        } catch (error) {
            logger.error(`Error syncing user ${userId}`, error);
        }
    }

    /**
     * Get user details from database
     */
    async getUserDetails(userId) {
        const userDetailsArray = await this.database.findAttendee(userId);
        if (!userDetailsArray || userDetailsArray.length === 0) {
            logger.error(`User details not found for ${userId}`);
            return null;
        }

        const userDetails = userDetailsArray[0];
        if (!userDetails.google_token) {
            logger.info(`User ${userId} has no Google Token`);
            return null;
        }

        return userDetails;
    }

    /**
     * Setup user authentication and get calendar
     */
    async setupUserAuth(userDetails, userId) {
        try {
            this.oauth.setCredentials({ refresh_token: userDetails.google_token });
            const { token: accessToken } = await this.oauth.getAccessToken();
            
            if (!accessToken) {
                logger.error(`No access token for user ${userId}`);
                return { accessToken: null, calendarId: null };
            }

            const calendar = google.calendar({ version: "v3", auth: this.oauth });
            let calendarId = userDetails.calendar_id;

            // Ensure calendar exists
            calendarId = await this.ensureCalendarExists(calendar, calendarId, userDetails.telegram_id, userId);
            
            return { accessToken, calendarId };

        } catch (error) {
            logger.error(`Failed to setup auth for user ${userId}`, error);
            return { accessToken: null, calendarId: null };
        }
    }

    /**
     * Ensure user has a calendar, create if necessary
     */
    async ensureCalendarExists(calendar, calendarId, telegramId, userId) {
        try {
            if (calendarId) {
                await calendar.calendars.get({ calendarId });
                logger.info(`Calendar ${calendarId} found for user ${userId}`);
                return calendarId;
            }
        } catch (error) {
            logger.info(`Calendar not found for user ${userId}, creating new one`);
        }

        try {
            const newCal = await calendar.calendars.insert({
                requestBody: { 
                    summary: "Modeus Integration", 
                    timeZone: "Asia/Yekaterinburg" 
                },
            });

            const newCalendarId = newCal.data.id;
            await this.database.saveCalendarID(telegramId, newCalendarId);
            logger.success(`Created new calendar ${newCalendarId} for user ${userId}`);
            return newCalendarId;

        } catch (error) {
            logger.error(`Failed to create calendar for user ${userId}`, error);
            return null;
        }
    }

    /**
     * Process user events with batch operations
     */
    async processUserEvents(userId, modeusEvents, accessToken, calendarId, syncStartTime) {
        try {
            // Get existing Google events for this user
            const existingGoogleEvents = await this.getExistingGoogleEvents(
                userId, modeusEvents, accessToken, calendarId
            );

            // Prepare batch operations for creating/updating events
            const batchOperations = await this.prepareBatchOperations(
                userId, modeusEvents, existingGoogleEvents, calendarId, syncStartTime
            );

            // Execute batch operations
            if (batchOperations.length > 0) {
                await this.executeBatchOperations(batchOperations, accessToken, userId);
            } else {
                logger.info(`User ${userId}: No events to create or update`);
            }

        } catch (error) {
            logger.error(`Error processing events for user ${userId}`, error);
        }
    }

    /**
     * Get existing Google events using batch requests
     */
    async getExistingGoogleEvents(userId, modeusEvents, accessToken, calendarId) {
        const existingEventMap = new Map();
        const batchGetRequests = [];

        // Prepare batch GET requests for existing events
        for (const userEvent of modeusEvents) {
            const modeusEventId = userEvent.event_id;
            const uniqueEventId = `${modeusEventId}-${userId}`;
            const dbCalendarEntries = await this.database.findCalendarEvent(uniqueEventId);

            if (dbCalendarEntries?.[0]?.calendar_id) {
                const googleEventId = dbCalendarEntries[0].calendar_id;
                existingEventMap.set(modeusEventId, googleEventId);
                batchGetRequests.push({
                    method: "GET",
                    endpoint: `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${googleEventId}`,
                    customOperationId: googleEventId,
                });
            }
        }

        if (batchGetRequests.length === 0) {
            return new Map();
        }

        // Execute batch GET requests
        const validGoogleEvents = new Map();
        const chunks = this.chunkArray(batchGetRequests, this.appConfig.google_batch_limit);
        
        for (const chunk of chunks) {
            try {
                const batchResponse = await RunBatch({
                    accessToken,
                    requests: chunk,
                    api: { name: "calendar", version: "v3" },
                    skipError: true,
                });

                this.processBatchGetResponse(batchResponse, chunk, existingEventMap, validGoogleEvents, userId);
                
            } catch (error) {
                logger.warn(`Batch GET failed for user ${userId}: ${error.message}`);
            }

            if (chunks.length > 1) await this.delay(500);
        }

        return validGoogleEvents;
    }

    /**
     * Process batch GET response
     */
    processBatchGetResponse(batchResponse, originalRequests, existingEventMap, validGoogleEvents, userId) {
        if (!Array.isArray(batchResponse)) return;

        for (let i = 0; i < batchResponse.length; i++) {
            const response = batchResponse[i];
            const request = originalRequests[i];
            
            if (!request) continue;

            const googleEventId = request.customOperationId;
            const modeusEventId = this.findModeusIdByGoogleId(existingEventMap, googleEventId);

            if (response?.id && response.status !== "cancelled") {
                validGoogleEvents.set(modeusEventId, googleEventId);
            } else {
                // Event not found or cancelled, remove from database
                if (modeusEventId) {
                    this.database.deleteCalendarEvent(`${modeusEventId}-${userId}`).catch(() => {});
                }
            }
        }
    }

    /**
     * Find Modeus event ID by Google event ID
     */
    findModeusIdByGoogleId(existingEventMap, googleEventId) {
        for (const [modeusId, googleId] of existingEventMap.entries()) {
            if (googleId === googleEventId) {
                return modeusId;
            }
        }
        return null;
    }

    /**
     * Prepare batch operations for calendar events
     */
    async prepareBatchOperations(userId, modeusEvents, existingGoogleEvents, calendarId, syncStartTime) {
        const batchOperations = [];
        const refreshDisplay = this.getRefreshDisplayTime(syncStartTime);

        for (const userEvent of modeusEvents) {
            const modeusEventId = userEvent.event_id;
            const eventData = await this.getModeusEventData(modeusEventId);
            
            if (!eventData) continue;

            const eventResource = this.buildEventResource(eventData, refreshDisplay);
            const existingGoogleEventId = existingGoogleEvents.get(modeusEventId);

            if (existingGoogleEventId) {
                // Update existing event
                batchOperations.push({
                    method: "PUT",
                    endpoint: `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingGoogleEventId}`,
                    requestBody: eventResource,
                    customOperationId: modeusEventId,
                    originalGoogleId: existingGoogleEventId,
                });
            } else {
                // Create new event
                const newGoogleEventId = crypto.randomBytes(16).toString("hex");
                batchOperations.push({
                    method: "POST",
                    endpoint: `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
                    requestBody: { ...eventResource, id: newGoogleEventId },
                    customOperationId: modeusEventId,
                    originalGoogleId: newGoogleEventId,
                });
            }
        }

        return batchOperations;
    }

    /**
     * Get Modeus event data with caching
     */
    async getModeusEventData(eventId) {
        try {
            const eventDetails = await this.database.getEvent(eventId);
            if (eventDetails[0]?.event_data) {
                return JSON.parse(eventDetails[0].event_data);
            }
            return null;
        } catch (error) {
            logger.warn(`Failed to get event data for ${eventId}`, error);
            return null;
        }
    }

    /**
     * Build Google Calendar event resource
     */
    buildEventResource(eventData, refreshDisplay) {
        const sasEvent = eventData.name.match(/\d\.\d/g);
        let eventName = `${eventData.name} / ${eventData.course}`;
        const type = eventData.typeId === "LECT" ? "L" : "S";
        
        if (sasEvent != null) {
            eventName = `${sasEvent}${type} / ${eventData.course}`;
        }

        const color = this.getEventColor(eventData.typeId);
        const professorList = `Преподаватели:\n${eventData.teachers.join("\n") || "Не указаны"}`;

        return {
            summary: eventName,
            description: `Курс: ${eventData.course}\n${eventData.name}\nУчастники: ${
                eventData.attendees.length - eventData.teachers.length
            } участников\n\n${professorList}\nОбновлено: ${refreshDisplay}`,
            start: { dateTime: eventData.start, timeZone: "Asia/Yekaterinburg" },
            end: { dateTime: eventData.end, timeZone: "Asia/Yekaterinburg" },
            location: eventData.room,
            colorId: color,
            status: "confirmed",
        };
    }

    /**
     * Get event color based on type
     */
    getEventColor(typeId) {
        const colorMap = {
            "LECT": "10",      // Lectures
            "CONS": "2",       // Consultations
            "MID_CHECK": "4",  // Mid checks
            "CUR_CHECK": "4",  // Current checks
            "EVENT_OTHER": "8" // Other events
        };
        
        return colorMap[typeId] || "1"; // Default color
    }

    /**
     * Execute batch operations
     */
    async executeBatchOperations(operations, accessToken, userId) {
        const chunks = this.chunkArray(operations, this.appConfig.google_batch_limit);
        logger.info(`User ${userId}: Executing ${operations.length} operations in ${chunks.length} batches`);

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            try {
                const chunk = chunks[chunkIndex];
                const batchResponse = await RunBatch({
                    accessToken,
                    requests: chunk,
                    api: { name: "calendar", version: "v3" },
                    skipError: true,
                });

                await this.processBatchWriteResponse(batchResponse, chunk, userId);

            } catch (error) {
                logger.error(`Batch operation failed for user ${userId} (chunk ${chunkIndex + 1})`, error);
            }

            if (chunks.length > 1 && chunkIndex < chunks.length - 1) {
                await this.delay(1000);
            }
        }
    }

    /**
     * Process batch write response and update database
     */
    async processBatchWriteResponse(batchResponse, originalRequests, userId) {
        if (!Array.isArray(batchResponse)) return;

        const dbUpdates = [];

        for (let i = 0; i < batchResponse.length; i++) {
            const response = batchResponse[i];
            const request = originalRequests[i];
            
            if (!request) continue;

            const modeusEventId = request.customOperationId;
            const attemptedGoogleId = request.originalGoogleId;

            if (response?.id) {
                // Success - save to database
                const eventTimestamp = Math.floor(Date.now() / 1000);
                dbUpdates.push({
                    uniqueId: `${modeusEventId}-${userId}`,
                    calendarId: response.id,
                    timestamp: Math.floor(Date.now() / 1000),
                    eventTimestamp: eventTimestamp
                });
            } else {
                logger.warn(`Failed to create/update event ${modeusEventId} for user ${userId}: ${response?.error?.message || 'Unknown error'}`);
            }
        }

        // Batch update database
        if (dbUpdates.length > 0) {
            const updatePromises = dbUpdates.map(update => 
                this.database.saveCalendarEvent(update.uniqueId, update.calendarId, update.timestamp, update.eventTimestamp)
            );
            await Promise.allSettled(updatePromises);
        }
    }

    /**
     * Reset all calendars (admin function)
     */
    async resetAllCalendars() {
        try {
            const loggedUsers = await this.database.getLoggedAttendees();
            
            for (const user of loggedUsers) {
                try {
                    const userDetails = await this.getUserDetails(user.attendee_id);
                    if (!userDetails?.google_token) continue;

                    this.oauth.setCredentials({ refresh_token: userDetails.google_token });
                    const calendar = google.calendar({ version: "v3", auth: this.oauth });

                    if (userDetails.calendar_id) {
                        await calendar.calendars.delete({ calendarId: userDetails.calendar_id });
                        await this.database.saveCalendarID(userDetails.telegram_id, null);
                        logger.info(`Deleted calendar for user ${user.attendee_id}`);
                    }
                } catch (error) {
                    logger.warn(`Failed to delete calendar for user ${user.attendee_id}`, error);
                }
            }

            await this.database.removeCalendarEvents();
            logger.success("All calendars reset successfully");

        } catch (error) {
            logger.error("Error resetting calendars", error);
        }
    }

    /**
     * Utility functions
     */
    getRefreshDisplayTime(timestamp) {
        const date = new Date((timestamp + 5 * 60 * 60) * 1000);
        return date.toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' });
    }

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

    // This would need to be injected or passed from the bot instance
    async sendTelegramMessage(telegramId, message) {
        // This is a placeholder - in real implementation, this would use the bot instance
        logger.info(`Telegram message to ${telegramId}: ${message}`);
    }
}

module.exports = GoogleCalendarService;