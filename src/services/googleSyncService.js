const Logger = require("../Logger");
const crypto = require("crypto");
const { getGoogleAuth, getCalendar, createCalendar, getAccessToken, batchGet, batchDelete, batchWrite, deleteCalendar } = require("../api/google");
const { day, month, year, hour, minute, second } = require("../utils/date");

const GOOGLE_API_BATCH_LIMIT = 50;

async function syncGoogleCalendar(db) {
    Logger.infoMessage("Syncing with Google Calendar...");
    const google_sync_start_time = Math.floor(new Date().getTime() / 1000);
    const rd = new Date(google_sync_start_time * 1000 + 5 * 60 * 60 * 1000);
    const refresh_display = `${day(rd)}.${month(rd)}.${year(rd)} ${hour(rd)}:${minute(rd)}:${second(rd)}`;

    const logged_google_users = db.getLoggedAttendees();
    const userProcessingPromises = [];

    let batch = [];

    for await (const gcal_user of logged_google_users) {
        if(batch.length >= 5){
            userProcessingPromises.push(batch);
            batch = [];
        }
        batch.push(gcal_user);
    }

    async function batchProcess(batch){
        let runners = [];

        for(const user of batch){
            runners.push(processUser(user, db, refresh_display));
        }
        
        await Promise.allSettled(runners);
    }

    userProcessingPromises.push(batch);

    for(const batch of userProcessingPromises){
        await batchProcess(batch);
    }

    Logger.successMessage("Finished syncing all users with Google Calendar.");
    console.log(`Google Sync Total Time: ${Math.floor(new Date().getTime() / 1000) - google_sync_start_time} seconds`);
}

async function processUser(gcal_user, db, refresh_display) {
    const user_modeus_id = gcal_user.attendee_id;
    Logger.infoMessage(`Starting Google Calendar sync for user ${user_modeus_id}`);
    try {
        const modeus_events_for_this_user = await db.getUserEvents(user_modeus_id);
        if (modeus_events_for_this_user.length === 0) {
            Logger.infoMessage(`User ${user_modeus_id}: No Modeus events to sync.`);
            return;
        }

        Logger.infoMessage(`User ${user_modeus_id}: Found ${modeus_events_for_this_user.length} events to sync.`);

        const user_details_array = await db.findAttendee(user_modeus_id);
        if (!user_details_array || user_details_array.length === 0) {
            Logger.errorMessage(`User details not found for ${user_modeus_id}`);
            return;
        }
        const user_details = user_details_array[0];
        if (!user_details.google_token) {
            Logger.infoMessage(`User ${user_modeus_id} has no Google Token`);
            return;
        }

        const calendarOAuthInstance = getGoogleAuth();
        calendarOAuthInstance.setCredentials({ refresh_token: user_details.google_token });
        const accessToken = await getAccessToken(calendarOAuthInstance);
        if (!accessToken) {
            Logger.errorMessage(`No access token for ${user_modeus_id}`);
            return;
        }

        let app_calendar_id = user_details.calendar_id;

        try {
            if (app_calendar_id) {
                await getCalendar(calendarOAuthInstance, app_calendar_id);
                Logger.infoMessage(`Calendar ${app_calendar_id} found for user ${user_modeus_id}`);
            } else {
                throw new Error("No calendar ID");
            }
        } catch (e) {
            Logger.infoMessage(`No valid calendar for user ${user_modeus_id}. Creating.`);
            try {
                app_calendar_id = await createCalendar(calendarOAuthInstance);
                await db.saveCalendarID(user_details.telegram_id, app_calendar_id);
                Logger.infoMessage(`Created new calendar ${app_calendar_id} for user ${user_modeus_id}`);
            } catch (e) {
                Logger.errorMessage(`Failed to create new calendar for user ${user_modeus_id}: ${e.message}. Skipping user.`);
                return;
            }
        }

        if (!app_calendar_id) {
            Logger.errorMessage(`App calendar ID null for ${user_modeus_id} after check/create.`);
            return;
        }

        const { modeusIdToActiveGoogleIdMap, batch_delete } = await checkExistingEvents(db, user_modeus_id, modeus_events_for_this_user, accessToken, app_calendar_id);

        if (batch_delete.length > 0) {
            const batchDeleteRequests = batch_delete.map(missing_event => ({
                method: "DELETE",
                endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events/${missing_event}`,
                customOperationId: missing_event,
            }));
            await batchDelete(accessToken, batchDeleteRequests, app_calendar_id);
        }

        const batchWriteRequests = await prepareWriteRequests(db, modeus_events_for_this_user, user_modeus_id, modeusIdToActiveGoogleIdMap, app_calendar_id, refresh_display);

        if (batchWriteRequests.length > 0) {
            const writeResponses = await batchWrite(accessToken, batchWriteRequests, app_calendar_id);
            for(const response of writeResponses){
                await processWriteResponses(response.responses, response.originalRequests, db, user_modeus_id);
            }
        } else {
            Logger.infoMessage(`User ${user_modeus_id}: No events to create or update in Google Calendar.`);
        }

    } catch (userProcessingError) {
        const errorMessage = userProcessingError?.message || String(userProcessingError) || 'Unknown error';
        const errorStack = userProcessingError?.stack || 'No stack trace available';
        Logger.errorMessage(`Overall error processing Google Calendar for user ${user_modeus_id}: ${errorMessage}`);
        Logger.errorMessage(`Stack trace: ${errorStack}`);
    }
}

async function checkExistingEvents(db, user_modeus_id, modeus_events_for_this_user, accessToken, app_calendar_id) {
    const modeusIdToActiveGoogleIdMap = new Map();
    const googleIdToModeusIdForGet = new Map();
    const batchGetRequests = [];

    const dbCalendarEvents = await db.findCalendarEventsForUser(user_modeus_id);
    const dbEventMap = new Map(dbCalendarEvents.map(e => [e.modeus_id.split('-')[0], e.calendar_id]));

    for (const user_event_link of modeus_events_for_this_user) {
        const modeus_event_id = user_event_link.event_id;
        const google_id_from_db = dbEventMap.get(modeus_event_id);

        if (google_id_from_db) {
            modeusIdToActiveGoogleIdMap.set(modeus_event_id, google_id_from_db);
            googleIdToModeusIdForGet.set(google_id_from_db, modeus_event_id);
            batchGetRequests.push({
                method: "GET",
                endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events/${google_id_from_db}`,
                customOperationId: google_id_from_db,
            });
        }
    }

    const batch_delete = [];
    if (batchGetRequests.length > 0) {
        const getBatchResponses = await batchGet(accessToken, batchGetRequests, app_calendar_id);

        for (let respIdx = 0; respIdx < getBatchResponses.length; respIdx++) {
            const resp = getBatchResponses[respIdx];
            const originalReq = batchGetRequests[respIdx];
            if (!originalReq) continue;

            const fetchedGoogleId = originalReq.customOperationId;
            const correspondingModeusId = googleIdToModeusIdForGet.get(fetchedGoogleId);

            if (!correspondingModeusId) {
                Logger.warnMessage(`User ${user_modeus_id}: Could not map fetched Google ID ${fetchedGoogleId} back to a Modeus ID.`);
                continue;
            }

            let isValidAndActive = resp?.id && resp.status !== "cancelled";

            if (!isValidAndActive) {
                if (resp?.error?.code === 404 || resp.status === "cancelled") {
                    batch_delete.push(fetchedGoogleId);
                }
                await db.deleteCalendarEvent(`${correspondingModeusId};${user_modeus_id}`);
                modeusIdToActiveGoogleIdMap.delete(correspondingModeusId);
                Logger.infoMessage(`User ${user_modeus_id}: Removed mapping for Modeus ID ${correspondingModeusId} from DB and current sync map.`);
            }
        }
    }
    return { modeusIdToActiveGoogleIdMap, batch_delete };
}

async function prepareWriteRequests(db, modeus_events_for_this_user, user_modeus_id, modeusIdToActiveGoogleIdMap, app_calendar_id, refresh_display) {
    const batchWriteRequests = [];
    const modeusEventDetailsCache = new Map();

    const eventIds = modeus_events_for_this_user.map(e => e.event_id);
    const eventDetails = await db.getEvents(eventIds);
    for (const event of eventDetails) {
        modeusEventDetailsCache.set(event.event_id, JSON.parse(event.event_data));
    }

    for (const user_event_link of modeus_events_for_this_user) {
        const modeus_event_id = user_event_link.event_id;
        const event_data = modeusEventDetailsCache.get(modeus_event_id);

        if (!event_data) {
            Logger.warnMessage(`User ${user_modeus_id}: Missing event_data for Modeus ID ${modeus_event_id}. Skipping.`);
            continue;
        }

        const eventResourceBase = createEventResource(event_data, refresh_display);

        if (modeusIdToActiveGoogleIdMap.has(modeus_event_id)) {
            const existingGoogleId = modeusIdToActiveGoogleIdMap.get(modeus_event_id);
            batchWriteRequests.push({
                method: "PUT",
                endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events/${existingGoogleId}`,
                requestBody: eventResourceBase,
                customOperationId: modeus_event_id,
                originalGoogleId: existingGoogleId,
            });
        } else {
            const newRandomGoogleId = crypto.randomBytes(16).toString("hex");
            batchWriteRequests.push({
                method: "POST",
                endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events`,
                requestBody: { ...eventResourceBase, id: newRandomGoogleId },
                customOperationId: modeus_event_id,
                originalGoogleId: newRandomGoogleId,
            });
        }
    }
    return batchWriteRequests;
}

function createEventResource(event_data, refresh_display) {
    let sas_event = event_data.name.match(/\d.\d/g);
    let event_name = `${event_data.name} / ${event_data.course}`;
    let type = event_data.typeId === "LECT" ? "L" : "S";
    let color = event_data.typeId === "LECT" ? "10" : "1";
    if (sas_event != null) event_name = `${sas_event}${type} / ${event_data.course}`;

    if (["CONS"].includes(event_data.typeId)) {
        color = "2";
    }

    if (["MID_CHECK", "CUR_CHECK"].includes(event_data.typeId)) {
        color = "4";
    }

    if (["EVENT_OTHER"].includes(event_data.typeId)) {
        color = "8";
    }

    let professor_list = `Преподаватели:\n${event_data.teachers.join("\n") || "Не указаны"}`;

    return {
        summary: event_name,
        description: `Курс: ${event_data.course}\n${event_data.name}\nУчастники: ${event_data.attendees.length - event_data.teachers.length
            } участников\n\n${professor_list}\nОбновлено: ${refresh_display}`,
        start: { dateTime: event_data.start, timeZone: "Asia/Yekaterinburg" },
        end: { dateTime: event_data.end, timeZone: "Asia/Yekaterinburg" },
        location: event_data.room,
        colorId: color,
        status: "confirmed",
    };
}

async function processWriteResponses(writeBatchResponses, originalReqs, db, user_modeus_id) {
    if (!Array.isArray(writeBatchResponses)) {
        Logger.warnMessage(`User ${user_modeus_id}: Final PUT/POST batch response was not an array: ${JSON.stringify(writeBatchResponses)}`);
        return;
    }

    if (!Array.isArray(originalReqs)) {
        Logger.warnMessage(`User ${user_modeus_id}: Original requests array is not valid: ${JSON.stringify(originalReqs)}`);
        return;
    }

    const eventTimestamp = Math.floor(Date.now() / 1000);

    // Simple index-based matching since gbatchrequests should preserve order
    for (let respIdx = 0; respIdx < writeBatchResponses.length; respIdx++) {
        const resp = writeBatchResponses[respIdx];

        if (respIdx >= originalReqs.length) {
            Logger.warnMessage(`User ${user_modeus_id}: Response index ${respIdx} exceeds original requests length ${originalReqs.length}`);
            continue;
        }

        const originalReq = originalReqs[respIdx];
        if (!originalReq) {
            Logger.warnMessage(`User ${user_modeus_id}: No original request found for response index ${respIdx}`);
            continue;
        }

        const opModeusId = originalReq.customOperationId;
        if (!opModeusId) {
            Logger.warnMessage(`User ${user_modeus_id}: No Modeus ID (customOperationId) found for response index ${respIdx}`);
            continue;
        }
        const attemptedGoogleId = originalReq.originalGoogleId;
        
        // Handle batch response structure - check if response has result or is direct result
        const actualResult = resp.result || resp;
        const responseError = resp.error || actualResult.error;
        
        if (responseError) {
            Logger.errorMessage(`User ${user_modeus_id}: Error in response for Modeus ID ${opModeusId}: ${JSON.stringify(responseError)}`);
            
            if (originalReq.method === "PUT" && responseError.code === 404) {
                Logger.warnMessage(`User ${user_modeus_id}: PUT failed with 404 for Modeus ID ${opModeusId} (GCal ID ${attemptedGoogleId}). Deleting DB record.`);
                await db.deleteCalendarEvent(`${opModeusId};${user_modeus_id}`);
            } else if (originalReq.method === "POST" && responseError.code === 409) {
                Logger.warnMessage(`User ${user_modeus_id}: POST failed with 409 (Conflict) for Modeus ID ${opModeusId} with NEW GCal ID ${attemptedGoogleId}. This is unexpected with random IDs. Not saving to DB.`);
            }
            continue;
        }
        
        if (actualResult.id) {
            try {
                if (originalReq.method === "POST") {
                    if (actualResult.id !== attemptedGoogleId) {
                        Logger.warnMessage(`User ${user_modeus_id}: POST success for Modeus ID ${opModeusId}, but GCal ID mismatch! Expected ${attemptedGoogleId}, got ${actualResult.id}. Saving actual returned ID.`);
                    }
                    await db.saveCalendarEvent(`${opModeusId};${user_modeus_id}`, actualResult.id, eventTimestamp);
                } else if (originalReq.method === "PUT") {
                    // For PUT requests, we should also ensure the mapping exists in DB
                    await db.saveCalendarEvent(`${opModeusId};${user_modeus_id}`, actualResult.id, eventTimestamp);
                }
            } catch (saveError) {
                Logger.errorMessage(`User ${user_modeus_id}: Failed to save calendar event for Modeus ID ${opModeusId}: ${saveError.message}`);
            }
        } else {
            Logger.errorMessage(`User ${user_modeus_id}: No ID in successful response for Modeus ID ${opModeusId}: ${JSON.stringify(actualResult)}`);
        }
    }
}

async function resetCalendars(db) {
    try {
        let logged_google_users = db.getLoggedAttendees();
        for await (const gcal_user of logged_google_users) {
            let user_modeus_id = gcal_user.attendee_id;
            let user_details_array = await db.findAttendee(user_modeus_id);
            let user_details = user_details_array[0];
            if (!user_details.google_token) {
                Logger.infoMessage(`Admin: User ${user_modeus_id} has no Google Token, skipping calendar deletion.`);
                continue;
            }
            const calendarOAuthInstance = getGoogleAuth();
            calendarOAuthInstance.setCredentials({ refresh_token: user_details.google_token });
            let app_calendar_id = user_details.calendar_id;

            if (app_calendar_id) {
                await deleteCalendar(calendarOAuthInstance, app_calendar_id);
            }
            await db.saveCalendarID(user_details.telegram_id, null);
        }

        await db.removeCalendarEvents();
        Logger.successMessage("Admin: Done - Deleted Calendars");
    } catch (e) {
        Logger.errorMessage(`Admin: Error resetting calendars: ${e.message}`);
    }
}


module.exports = {
    syncGoogleCalendar,
    resetCalendars
};