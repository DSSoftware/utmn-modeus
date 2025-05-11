/**
 *  Importing modules
 */
const Logger = require("./src/Logger");
const crypto = require("crypto");
const axios = require("axios");
const config = require("./config");
const Database = require("./src/Database");
const tg = require("telegraf");
const { google } = require("googleapis");
const { RunBatch } = require("gbatchrequests");

const bot = new tg.Telegraf(config.credentials.telegram);
let db = new Database();
db.setup();

const googleOAuth = new google.auth.OAuth2(config.google.client_id, config.google.secret_id, config.google.redirect);

let local_token_cache = {
    token: "",
    timestamp: 0,
};

function transformModeusIdToGoogleId(modeusEventId) {
    if (!modeusEventId || typeof modeusEventId !== "string") {
        Logger.warnMessage(`Invalid Modeus Event ID for transformation: ${modeusEventId}`);
        return null;
    }
    return modeusEventId.replace(/-/g, "").toLowerCase();
}

let year = (d) => {
    return ("0000" + d.getUTCFullYear()).slice(-4);
};
let month = (d) => {
    return ("00" + (d.getUTCMonth() + 1)).slice(-2);
};
let day = (d) => {
    return ("00" + d.getUTCDate()).slice(-2);
};
let hour = (d) => {
    return ("00" + d.getUTCHours()).slice(-2);
};
let minute = (d) => {
    return ("00" + d.getUTCMinutes()).slice(-2);
};

function getDates() {
    let first_monday = 0 + 4 * 24 * 60 * 60 * 1000;
    let timestamp = new Date().getTime();
    let diff = (timestamp - first_monday) % (7 * 24 * 60 * 60 * 1000);

    let start_timestamp = timestamp - diff - 5 * 60 * 60 * 1000;
    let end_timestamp = start_timestamp + 2 * 7 * 24 * 60 * 60 * 1000;

    let sd = new Date(start_timestamp);
    let ed = new Date(end_timestamp);

    return {
        start: `${year(sd)}-${month(sd)}-${day(sd)}T19:00:00Z`,
        end: `${year(ed)}-${month(ed)}-${day(ed)}T19:00:00Z`,
        start_timestamp: start_timestamp,
        end_timestamp: end_timestamp,
    };
}

async function getModeusToken() {
    if (local_token_cache.token != "") {
        if (local_token_cache.timestamp >= new Date().getTime() / 1000 - 1 * 60 * 60) {
            return local_token_cache.token;
        }
    }

    let token = await fetchModeusToken();
    local_token_cache.token = token;
    local_token_cache.timestamp = Math.floor(new Date().getTime() / 1000);

    return token;
}

async function fetchModeusToken() {
    let cached_token = await db.getConfigValue("modeus_token", 12 * 60 * 60);
    if (cached_token.length != 0) {
        let cached_value = cached_token?.[0]?.["value"];
        if (cached_value != undefined && cached_value != null && cached_value != "") {
            Logger.infoMessage("Using cached Modeus token.");
            return cached_value;
        }
    }

    let nonce = crypto.randomBytes(20).toString("hex");

    let request_1 = await axios({
        method: "GET",
        url: "https://auth.modeus.org/oauth2/authorize",
        params: {
            response_type: "id_token token",
            client_id: "sKir7YQnOUu4G0eCfn3tTxnBfzca",
            state: nonce,
            nonce: nonce,
            redirect_uri: "https://utmn.modeus.org/schedule-calendar/",
            scope: "openid",
        },
        headers: {},
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    let request_2_location = request_1.request.res.headers.location;
    let tc01_cookie = request_1.request.res.headers["set-cookie"][0].split(";")[0];

    let request_2 = await axios(request_2_location, {
        method: "GET",
        headers: {
            Host: "fs.utmn.ru",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": 1,
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "ru-RU,ru;q=0.9",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document",
            "sec-ch-ua": `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`,
            "sec-ch-ua-mobile": `?0`,
            "sec-ch-ua-platform": `"Windows"`,
            Referer: `https://utmn.modeus.org/`,
        },
    });

    let session_cookie = request_2.request.res.headers["set-cookie"][0].split(";")[0];
    let request_3_match = request_2.data.match(/method="post" action="https:\/\/fs\.utmn\.ru:443\/adfs\/ls\?.*?">/gm);

    let request_3_location = request_3_match[0].replace(`method="post" action="`, "").replace(`">`, "");

    let auth_string = `UserName=${encodeURIComponent(config.credentials.utmn.login)}&Password=${encodeURIComponent(
        config.credentials.utmn.password
    )}&AuthMethod=FormsAuthentication`;

    let request_3 = await axios(request_3_location, {
        method: "POST",
        headers: {
            Host: "fs.utmn.ru",
            Connection: "keep-alive",
            "Content-Length": auth_string.length,
            "Cache-Control": "max-age=0",
            "sec-ch-ua": `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`,
            "sec-ch-ua-mobile": `?0`,
            "sec-ch-ua-platform": `"Windows"`,
            Origin: "https://fs.utmn.ru",
            "Content-Type": "application/x-www-form-urlencoded",
            "Upgrade-Insecure-Requests": 1,
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            Referer: request_2_location,
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "ru-RU,ru;q=0.9",
            Cookie: session_cookie,
        },
        data: auth_string,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    let request_4_location = request_3.request.res.headers.location;
    let MSISAuth_Cookie = request_3.request.res.headers["set-cookie"][0].split(";")[0];

    let request_4 = await axios(request_4_location, {
        method: "GET",
        headers: {
            Host: "fs.utmn.ru",
            Connection: "keep-alive",
            "Cache-Control": "max-age=0",
            "Upgrade-Insecure-Requests": 1,
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            "sec-ch-ua": `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`,
            "sec-ch-ua-mobile": `?0`,
            "sec-ch-ua-platform": `"Windows"`,
            Referer: request_2_location,
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "ru-RU,ru;q=0.9",
            Cookie: `${MSISAuth_Cookie}; ${session_cookie}`,
        },
    });

    let request_5_location = "https://auth.modeus.org/commonauth";

    let SAMLResponse = request_4.data
        .match(/<input type="hidden" name="SAMLResponse" value=".*?" \/>/gm)[0]
        .replace(`<input type="hidden" name="SAMLResponse" value="`, "")
        .replace(`" />`, "");

    let RelayState = request_4.data
        .match(/<input type="hidden" name="RelayState" value=".*?" \/>/gm)[0]
        .replace(`<input type="hidden" name="RelayState" value="`, "")
        .replace(`" />`, "");

    let modeus_saml_string = `SAMLResponse=${encodeURIComponent(SAMLResponse)}&RelayState=${encodeURIComponent(
        RelayState
    )}`;

    let request_5 = await axios(request_5_location, {
        method: "POST",
        headers: {
            "content-length": modeus_saml_string.length,
            "cache-control": "max-age=0",
            "sec-ch-ua": `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`,
            "sec-ch-ua-mobile": `?0`,
            "sec-ch-ua-platform": `"Windows"`,
            origin: "https://fs.utmn.ru",
            "content-type": "application/x-www-form-urlencoded",
            "upgrade-insecure-requests": 1,
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            referer: "https://fs.utmn.ru/",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "ru-RU,ru;q=0.9",
            cookie: tc01_cookie,
        },
        data: modeus_saml_string,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    let request_6_location = request_5.request.res.headers.location;
    let modeus_cookie_1 = request_5.request.res.headers["set-cookie"][0].split(";")[0];
    let modeus_cookie_2 = request_5.request.res.headers["set-cookie"][0].split(";")[1];

    let request_6 = await axios(request_6_location, {
        method: "POST",
        headers: {
            "cache-control": "max-age=0",
            "upgrade-insecure-requests": 1,
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            "sec-ch-ua": `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`,
            "sec-ch-ua-mobile": `?0`,
            "sec-ch-ua-platform": `"Windows"`,
            referer: "https://fs.utmn.ru/",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "ru-RU,ru;q=0.9",
            cookie: `${tc01_cookie}; ${modeus_cookie_1}; ${modeus_cookie_2}`,
        },
        data: modeus_saml_string,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    let access_token = request_6.request.res.headers.location
        .match(/id_token=.*?&/gm)[0]
        .replace(`id_token=`, "")
        .replace(`&`, "");

    if (access_token != undefined && access_token != "") {
        await db.setConfigValue("modeus_token", access_token);
        return access_token;
    }

    throw new Error("Unable to obtain access token.");
}

async function findModeusUser(name) {
    try {
        let request = await axios({
            method: "POST",
            url: "https://utmn.modeus.org/schedule-calendar-v2/api/people/persons/search",
            data: {
                fullName: name,
                page: 0,
                size: 5,
                sort: "+fullName",
            },
            headers: {
                Authorization: `Bearer ${await getModeusToken()}`,
            },
        });

        let search_result = request.data._embedded;

        let students_to_show = [];
        for (const user of search_result?.persons ?? []) {
            let user_name = user.fullName;
            let user_id = user.id;

            let student_info = "";

            for (const student_profile of search_result?.students ?? []) {
                if (student_profile.personId == user_id) {
                    student_info = ` (${student_profile.flowCode.substring(0, 4)} | ${student_profile.specialtyCode})`;
                }
            }

            students_to_show.push({
                name: user_name,
                id: user_id,
                student: student_info,
            });
        }

        return students_to_show;
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function getEventAttendees(event_id) {
    try {
        let request = await axios({
            method: "GET",
            url: `https://utmn.modeus.org/schedule-calendar-v2/api/calendar/events/${event_id}/attendees`,
            headers: {
                Authorization: `Bearer ${await getModeusToken()}`,
            },
        });

        return request.data;
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function findModeusEvents(attendees) {
    let dates = getDates();

    try {
        let request = await axios({
            method: "POST",
            url: "https://utmn.modeus.org/schedule-calendar-v2/api/calendar/events/search?tz=Asia/Tyumen",
            data: {
                attendeePersonId: attendees,
                size: 1000,
                timeMin: dates.start,
                timeMax: dates.end,
            },
            headers: {
                Authorization: `Bearer ${await getModeusToken()}`,
            },
        });

        let prep_events = [];

        let event_locations = request.data._embedded["event-locations"];
        let events = request.data._embedded.events;

        let location_map = new Map();
        let rooms = new Map();
        let courses = new Map();

        for (const location of request.data._embedded["event-rooms"]) {
            location_map.set(location.id, location);
        }

        for (const room of request.data._embedded["rooms"]) {
            rooms.set(room.id, room);
        }

        for (const course of request.data._embedded["cycle-realizations"]) {
            courses.set(course.id, course);
        }

        let threads = 5;
        let promises = [];

        for (let thread = 0; thread < threads; thread++) {
            promises.push(
                new Promise(async (resolve, reject) => {
                    for (let i = thread; i < events.length; i += threads) {
                        try {
                            let place_info = "";

                            if (event_locations[i].customLocation != null) {
                                place_info = event_locations[i].customLocation;
                            } else {
                                let location = location_map.get(
                                    event_locations[i]._links["event-rooms"].href.substring(1)
                                );
                                let room = rooms.get(location._links.room.href.substring(1));
                                place_info = room.nameShort;
                            }

                            let course_name = courses.get(
                                events[i]._links["cycle-realization"].href.substring(1)
                            ).courseUnitRealizationNameShort;

                            let event_attendees_data = await getEventAttendees(events[i].id);
                            let attendees_list = [];
                            let teachers = [];
                            for (let event_attendee of event_attendees_data) {
                                attendees_list.push(event_attendee.personId);
                                if (event_attendee.roleId != "STUDENT") {
                                    teachers.push(event_attendee.fullName);
                                }
                            }

                            let event_data = {
                                info: events[i],
                                room_name: place_info,
                                course: course_name,
                                attendee_list: attendees_list,
                                teachers: teachers,
                            };
                            prep_events.push(event_data);
                        } catch (innerError) {
                            Logger.errorMessage(
                                `Error processing event detail for event ID ${events[i]?.id} in findModeusEvents: ${innerError.message}`
                            );
                        }
                    }
                    resolve(true);
                })
            );
        }
        await Promise.all(promises);
        return prep_events;
    } catch (e) {
        console.log(e);
        return [];
    }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGoogleApiWithRetry(apiCallFunction, logContext = "", maxRetries = 5, initialDelayMs = 1000) {
    let attempt = 0;
    let currentDelayMs = initialDelayMs;
    while (attempt < maxRetries) {
        try {
            return await apiCallFunction();
        } catch (error) {
            console.log(error);
            const statusCode = error.code;
            const detailedErrors = error.errors;

            let isSpecificRateLimitReason = false;
            if (statusCode === 403 && detailedErrors && Array.isArray(detailedErrors)) {
                isSpecificRateLimitReason = detailedErrors.some(
                    (e) => e.reason === "rateLimitExceeded" || e.reason === "userRateLimitExceeded"
                );
            }

            const isRateLimitError = statusCode === 429 || isSpecificRateLimitReason;
            const isServiceUnavailable = statusCode === 503;

            if ((isRateLimitError || isServiceUnavailable) && attempt < maxRetries - 1) {
                attempt++;
                Logger.warnMessage(
                    `${
                        isRateLimitError ? "Rate limit" : "Service unavailable"
                    } (Code: ${statusCode}) encountered for ${logContext}. Retrying in ${
                        currentDelayMs / 1000
                    }s... (Attempt ${attempt}/${maxRetries})`
                );
                await delay(currentDelayMs + Math.random() * 1000);
                currentDelayMs = Math.min(currentDelayMs * 2, 60000);
            } else {
                let errorMessage = "Unknown API error";
                if (detailedErrors && detailedErrors[0] && detailedErrors[0].message) {
                    errorMessage = detailedErrors[0].message;
                } else if (error.message) {
                    errorMessage = error.message;
                }
                Logger.errorMessage(
                    `Final error for ${logContext} after ${attempt + 1} attempts: ${errorMessage} (Code: ${statusCode})`
                );
                const finalError = new Error(`Final error for ${logContext}: ${errorMessage}`);
                finalError.code = statusCode;
                finalError.originalError = error;
                throw finalError; // Throw after logging
            }
        }
    }
}

async function init() {
    try {
        await getModeusToken();
        Logger.successMessage("Successfully connected to Modeus.");
    } catch (e) {
        console.log(e);
        Logger.errorMessage("Unable to get Modeus Access Token. Dying.");
        throw e;
    }

    setInterval(recheckModeus, 15 * 60 * 1000);
    recheckModeus();
}

async function recheckModeus() {
    Logger.infoMessage("Rechecking Modeus Events...");
    let attendees_for_modeus_fetch = [];
    let recheck_started_modeus = Math.floor(new Date().getTime() / 1000);

    let students_stat = 0;
    let events_stat = 0;

    async function fetchAssociatedEvents(attendee_list) {
        let events = await findModeusEvents(attendee_list);
        let db_save_promises = [];
        for (const event of events) {
            events_stat++;
            let event_object = {
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
            let timestamp = new Date(event.info.startsAt).getTime() / 1000;
            for (const attendee_id of attendee_list) {
                if (!event_object.attendees.includes(attendee_id)) continue;
                db_save_promises.push(
                    db.saveUserEvent(
                        `${attendee_id};${event.info.id}`,
                        attendee_id,
                        event.info.id,
                        recheck_started_modeus,
                        timestamp
                    )
                );
            }
            db_save_promises.push(
                db.saveEvent(event.info.id, recheck_started_modeus, timestamp, JSON.stringify(event_object))
            );
        }
        await Promise.all(db_save_promises);
    }

    let students = db.getRecheckUsers();
    for await (const student_user of students) {
        if (attendees_for_modeus_fetch.length >= 25) {
            await fetchAssociatedEvents(attendees_for_modeus_fetch);
            attendees_for_modeus_fetch = [];
        }
        attendees_for_modeus_fetch.push(student_user.attendee_id);
        students_stat++;
    }
    if (attendees_for_modeus_fetch.length > 0) {
        await fetchAssociatedEvents(attendees_for_modeus_fetch);
    }

    Logger.successMessage("Rechecked Modeus Events.");
    await db.setConfigValue("lastRefresh", recheck_started_modeus);
    console.log(`Modeus Recheck Stats:\nStudents: ${students_stat}\nEvents: ${events_stat}`);
    console.log(`Modeus Recheck Time: ${Math.floor(new Date().getTime() / 1000) - recheck_started_modeus} seconds`);
    let monday_timestamp = Math.floor(getDates().start_timestamp / 1000);
    await db.cleanupOldEvents(monday_timestamp, recheck_started_modeus);
    await db.cleanupOldStudentEvents(monday_timestamp, recheck_started_modeus);

    Logger.infoMessage("Syncing with Google Calendar...");
    let google_sync_start_time = Math.floor(new Date().getTime() / 1000);
    const GOOGLE_API_BATCH_LIMIT = 50;

    let logged_google_users = db.getLoggedAttendees();
    const calendarOAuthInstance = new google.auth.OAuth2(
        config.google.client_id,
        config.google.secret_id,
        config.google.redirect
    );

    for await (const gcal_user of logged_google_users) {
        let user_modeus_id = gcal_user.attendee_id;
        Logger.infoMessage(`Starting Google Calendar sync for user ${user_modeus_id}`);
        try {
            let modeus_events_for_this_user = await db.getUserEvents(user_modeus_id);
            if (modeus_events_for_this_user.length === 0) {
                Logger.infoMessage(`User ${user_modeus_id}: No Modeus events to sync.`);
                continue;
            }

            let user_details_array = await db.findAttendee(user_modeus_id);
            if (!user_details_array || user_details_array.length === 0) {
                Logger.errorMessage(`User details not found for ${user_modeus_id}`);
                continue;
            }
            let user_details = user_details_array[0];
            if (!user_details.google_token) {
                Logger.infoMessage(`User ${user_modeus_id} has no Google Token`);
                continue;
            }

            calendarOAuthInstance.setCredentials({ refresh_token: user_details.google_token });
            const { token: accessToken } = await calendarOAuthInstance.getAccessToken();
            if (!accessToken) {
                Logger.errorMessage(`No access token for ${user_modeus_id}`);
                continue;
            }

            const calendar_single_op = google.calendar({ version: "v3", auth: calendarOAuthInstance });
            let app_calendar_id = user_details.calendar_id;

            try {
                if (app_calendar_id == null) {
                    Logger.infoMessage(
                        `No app_calendar_id stored for user ${user_modeus_id}. Will attempt to create one.`
                    );
                    throw { code: 404, message: "Calendar not created locally" };
                }

                await callGoogleApiWithRetry(
                    () => calendar_single_op.calendars.get({ calendarId: app_calendar_id }),
                    `get calendar ${app_calendar_id} for user ${user_modeus_id}`
                );
                Logger.infoMessage(`Calendar ${app_calendar_id} found for user ${user_modeus_id}`);
            } catch (e) {
                Logger.infoMessage(`No app_calendar_id for user ${user_modeus_id}. Creating.`);
                try {
                    const newCal = await callGoogleApiWithRetry(
                        () =>
                            calendar_single_op.calendars.insert({
                                requestBody: { summary: "Modeus Integration", timeZone: "Asia/Yekaterinburg" },
                            }),
                        `insert calendar for user ${user_modeus_id}`
                    );
                    app_calendar_id = newCal.data.id;
                    await db.saveCalendarID(user_details.telegram_id, app_calendar_id);
                    Logger.infoMessage(`Created new calendar ${app_calendar_id} for user ${user_modeus_id}`);
                } catch (e) {
                    Logger.errorMessage(
                        `Failed to create new calendar for user ${user_modeus_id}: ${e.message}. Skipping user.`
                    );
                    continue;
                }
            }

            if (!app_calendar_id) {
                Logger.errorMessage(`App calendar ID null for ${user_modeus_id} after check/create.`);
                continue;
            }

            let batchGetRequests = [];
            let modeusEventDetailsCache = new Map();

            for (const user_event_link of modeus_events_for_this_user) {
                const modeus_event_id = user_event_link.event_id;
                const googleCompatibleEventId = transformModeusIdToGoogleId(modeus_event_id);
                if (!googleCompatibleEventId) continue;

                if (!modeusEventDetailsCache.has(modeus_event_id)) {
                    let event_detail_records = await db.getEvent(modeus_event_id);
                    if (event_detail_records[0].event_data) {
                        modeusEventDetailsCache.set(modeus_event_id, JSON.parse(event_detail_records[0].event_data));
                    } else {
                        Logger.warnMessage(`Missing full details for Modeus event ${modeus_event_id}. Cannot sync.`);
                        continue;
                    }
                }

                batchGetRequests.push({
                    method: "GET",
                    endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events/${googleCompatibleEventId}`,
                    customOperationId: modeus_event_id,
                });
            }

            let existingGoogleEventsMap = new Map();
            if (batchGetRequests.length > 0) {
                const getChunks = [];
                for (let i = 0; i < batchGetRequests.length; i += GOOGLE_API_BATCH_LIMIT) {
                    getChunks.push(batchGetRequests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
                }
                Logger.infoMessage(
                    `User ${user_modeus_id}: Prepared ${batchGetRequests.length} GET requests in ${getChunks.length} chunk(s).`
                );

                for (let chunkIndex = 0; chunkIndex < getChunks.length; chunkIndex++) {
                    const currentGetChunk = getChunks[chunkIndex];
                    const batchGetObj = {
                        accessToken: accessToken,
                        requests: currentGetChunk,
                        api: { name: "calendar", version: "v3" },
                    };
                    try {
                        Logger.infoMessage(`User ${user_modeus_id}: Executing GET batch ${chunkIndex + 1}.`);
                        const getBatchResponses = await RunBatch(batchGetObj);
                        if (Array.isArray(getBatchResponses)) {
                            getBatchResponses.forEach((resp, idx) => {
                                const originalReq = currentGetChunk[idx];
                                const opModeusId = originalReq.customOperationId;
                                if (resp.result.id) {
                                    existingGoogleEventsMap.set(opModeusId, resp.result);
                                }
                            });
                        } else {
                            Logger.warnMessage(
                                `User ${user_modeus_id}: GET batch response was not an array for chunk ${
                                    chunkIndex + 1
                                }.`
                            );
                        }
                    } catch (getBatchError) {
                        Logger.errorMessage(
                            `User ${user_modeus_id}: Critical error executing GET batch chunk ${chunkIndex + 1}: ${
                                getBatchError.message
                            }.`
                        );
                    }
                    if (getChunks.length > 1 && chunkIndex < getChunks.length - 1) await delay(500);
                }
            }

            let batchWriteRequests = [];
            for (const user_event_link of modeus_events_for_this_user) {
                const modeus_event_id = user_event_link.event_id;
                const googleCompatibleEventId = transformModeusIdToGoogleId(modeus_event_id);
                if (!googleCompatibleEventId) continue;

                const event_data = modeusEventDetailsCache.get(modeus_event_id);
                if (!event_data) {
                    Logger.warnMessage(
                        `User ${user_modeus_id}: Missing cached details for Modeus event ${modeus_event_id} during write prep.`
                    );
                    continue;
                }

                let sas_event = event_data.name.match(/\d.\d/g);
                let event_name = `${event_data.name} / ${event_data.course}`;
                let type = event_data.typeId === "LECT" ? "L" : "S";
                let color = event_data.typeId === "LECT" ? "10" : "1";
                if (sas_event != null) event_name = `${sas_event}${type} / ${event_data.course}`;
                let professor_list = `Преподаватели:\n${event_data.teachers.join("\n") || "Не указаны"}`;
                const eventResourceBase = {
                    summary: event_name,
                    description: `Курс: ${event_data.course}\n${event_data.name}\nУчастники: ${
                        event_data.attendees.length - event_data.teachers.length
                    } участников\n\n${professor_list}`,
                    start: { dateTime: event_data.start, timeZone: "Asia/Yekaterinburg" },
                    end: { dateTime: event_data.end, timeZone: "Asia/Yekaterinburg" },
                    location: event_data.room,
                    colorId: color,
                };

                if (existingGoogleEventsMap.has(modeus_event_id)) {
                    batchWriteRequests.push({
                        method: "PUT",
                        endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events/${googleCompatibleEventId}`,
                        requestBody: eventResourceBase,
                        customOperationId: modeus_event_id,
                    });
                } else {
                    batchWriteRequests.push({
                        method: "POST",
                        endpoint: `https://www.googleapis.com/calendar/v3/calendars/${app_calendar_id}/events`,
                        requestBody: { ...eventResourceBase, id: googleCompatibleEventId },
                        customOperationId: modeus_event_id,
                    });
                }
            }

            if (batchWriteRequests.length > 0) {
                const writeChunks = [];
                for (let i = 0; i < batchWriteRequests.length; i += GOOGLE_API_BATCH_LIMIT) {
                    writeChunks.push(batchWriteRequests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
                }
                Logger.infoMessage(
                    `User ${user_modeus_id}: Prepared ${batchWriteRequests.length} PUT/POST requests in ${writeChunks.length} chunk(s).`
                );

                for (let chunkIndex = 0; chunkIndex < writeChunks.length; chunkIndex++) {
                    const currentWriteChunk = writeChunks[chunkIndex];
                    const batchWriteObj = {
                        accessToken: accessToken,
                        requests: currentWriteChunk,
                        api: { name: "calendar", version: "v3" },
                    };
                    try {
                        Logger.infoMessage(`User ${user_modeus_id}: Executing PUT/POST batch ${chunkIndex + 1}.`);
                        const writeBatchResponses = await RunBatch(batchWriteObj);
                        if (Array.isArray(writeBatchResponses)) {
                            writeBatchResponses.forEach((resp, idx) => {
                                const originalReq = currentWriteChunk[idx];
                                const opModeusId = originalReq.customOperationId;
                                if (resp && resp.result && resp.result.id) {
                                    Logger.infoMessage(
                                        `User ${user_modeus_id}: Batch PUT/POST op success for Modeus ID ${opModeusId}, GCal ID: ${resp.result.id}`
                                    );
                                } else {
                                    const errDetail = resp?.error ||
                                        resp?.result?.error || { message: "Unknown PUT/POST error in batch" };
                                    Logger.errorMessage(
                                        `User ${user_modeus_id}: Batch PUT/POST op error for Modeus ID ${opModeusId}: ${errDetail.message} (Code: ${errDetail.code})`
                                    );
                                    if (originalReq.method === "POST" && errDetail.code === 409) {
                                        Logger.warnMessage(
                                            `User ${user_modeus_id}: Event (Modeus ${opModeusId}, GCal ${transformModeusIdToGoogleId(
                                                opModeusId
                                            )}) POST failed with 409 (Conflict).`
                                        );
                                    }
                                }
                            });
                        } else {
                            Logger.warnMessage(
                                `User ${user_modeus_id}: PUT/POST batch response was not an array for chunk ${
                                    chunkIndex + 1
                                }.`
                            );
                        }
                    } catch (writeBatchError) {
                        Logger.errorMessage(
                            `User ${user_modeus_id}: Critical error executing PUT/POST batch chunk ${chunkIndex + 1}: ${
                                writeBatchError.message
                            }.`
                        );
                    }
                    if (writeChunks.length > 1 && chunkIndex < writeChunks.length - 1) await delay(1000);
                }
            } else {
                Logger.infoMessage(
                    `User ${user_modeus_id}: No events to create or update in Google Calendar after GET checks.`
                );
            }
        } catch (userProcessingError) {
            Logger.errorMessage(
                `Overall error processing Google Calendar for user ${user_modeus_id}: ${userProcessingError.message} ${userProcessingError.stack}`
            );
        }
    }
    Logger.successMessage("Finished syncing all users with Google Calendar.");
    console.log(`Google Sync Total Time: ${Math.floor(new Date().getTime() / 1000) - google_sync_start_time} seconds`);
}

let textHandlers = [];
let user_states = new Map();

bot.hears(/^(?!\/).*$/, (ctx) => {
    if (ctx.message.text.startsWith("/")) {
        return;
    }
    for (const text_handler of textHandlers) {
        text_handler(ctx);
    }
});

textHandlers.push(async (ctx) => {
    if (ctx.from.id != config.admin) return;
    if (ctx.message.text == "reset_calendars") {
        try {
            let logged_google_users = db.getLoggedAttendees();
            const calendarOAuthInstance = new google.auth.OAuth2(
                config.google.client_id,
                config.google.secret_id,
                config.google.redirect
            );
            for await (const gcal_user of logged_google_users) {
                let user_modeus_id = gcal_user.attendee_id;
                let user_details_array = await db.findAttendee(user_modeus_id);
                let user_details = user_details_array[0];
                if (!user_details.google_token) {
                    Logger.infoMessage(`User ${user_modeus_id} has no Google Token`);
                    continue;
                }
                calendarOAuthInstance.setCredentials({ refresh_token: user_details.google_token });
                const calendar_single_op = google.calendar({ version: "v3", auth: calendarOAuthInstance });
                let app_calendar_id = user_details.calendar_id;

                await calendar_single_op.calendars.delete({ calendarId: app_calendar_id }).catch((e) => {console.log(e)});
                await db.saveCalendarID(user_details.telegram_id, null);
            }
        } catch (e) {
            console.log(e);
        }
        ctx.reply("Done - Deleted Calendars");
    }
    if (ctx.message.text == "redo_checks") {
        try {
            await recheckModeus();
        } catch (e) {
            console.log(e);
        }
        ctx.reply("Done - Rechecked Modeus Events");
    }
});

bot.action(/reset_listeners/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    user_states.set(ctx.from.id, "none");
    ctx.deleteMessage(ctx.callbackQuery?.message?.message_id).catch(() => {});
});

init();
registerInfoCommands();
registerModeusSync();
registerGoogleSync();

function registerInfoCommands() {
    async function sendHelpDialog(ctx) {
        ctx.reply(
            `Этот бот может привязать твой аккаунт Modeus (ТюмГУ) к календарю Google.\n📅 Расписание будет автоматически появляться и обновляться в календаре.\n\n<b><u>🔗 Как подключить?</u></b>\n🎓 1. Используй команду /link_modeus чтобы выбрать твой аккаунт Modeus.\n📅 2. Используй команду /link_google чтобы подключить бота к календарю.\n⌛ 3. Расписание подгрузится автоматически в течение 15 минут.\n\nТы можешь проверить время последнего обновления при помощи команды /info`,
            {
                parse_mode: "HTML",
            }
        ).catch((e) => Logger.errorMessage(`Error sending help dialog: ${e.message}`));
    }

    bot.command("info", (ctx) => {
        (async () => {
            ctx.deleteMessage(ctx.message.message_id).catch(() => {});

            let user_info = await db.getUserInfo(ctx.from.id);

            let linked_modeus = false;
            let linked_google = false;

            if (user_info.length != 0) {
                if (user_info[0].attendee_id != null) {
                    linked_modeus = true;
                }
                if (user_info[0].google_token != null) {
                    linked_google = true;
                }
            }

            let can_refresh = linked_google && linked_modeus;

            let last_refresh = await db.getConfigValue("lastRefresh");
            let relative_refresh = "никогда";
            if (last_refresh.length == 1) {
                let rd = new Date(last_refresh[0].value * 1000 + 5 * 60 * 60 * 1000);

                relative_refresh = `${day(rd)}.${month(rd)}.${year(rd)} ${hour(rd)}:${minute(rd)}`;
            }

            ctx.reply(
                `<b><u>👤 Информация</u></b>\n\n<u>🔗 Профили</u>\nПрофиль Modeus: <b>${
                    linked_modeus ? "✅ Привязан" : "❌ Не привязан"
                }</b>\nПрофиль Google: <b>${linked_google ? "✅ Привязан" : "❌ Не привязан"}</b>\n\nНастройка: <b>${
                    can_refresh ? "✅ Готово к работе" : "❌ Один из профилей не привязан"
                }</b>\n\n<u>🔁 Последнее обновление</u>\nСписок событий Modeus обновлён <u>${relative_refresh}</u> (UTC+5)`,
                {
                    parse_mode: "HTML",
                }
            ).catch((e) => Logger.errorMessage(`Error sending info reply: ${e.message}`));
        })();
    });

    bot.start((ctx) => {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        sendHelpDialog(ctx);
    });

    bot.help((ctx) => {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        sendHelpDialog(ctx);
    });
}

function registerModeusSync() {
    bot.command("link_modeus", (ctx) => {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});
        ctx.reply(
            `<b><u>🎓 Подключение Modeus</u></b>\n\nВведи полное ФИО в таком порядке:\n<code>Иванов Иван Иванович</code>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]],
                },
            }
        ).catch((e) => Logger.errorMessage(`Error sending link_modeus prompt: ${e.message}`));
        user_states.set(ctx.from.id, "modeus_listener");
    });

    textHandlers.push(async (ctx) => {
        if (user_states.get(ctx.from.id) != "modeus_listener") {
            return;
        }
        try {
            let user_name = ctx.message.text;
            let search_results = await findModeusUser(user_name);

            let buttons = [];

            for (const student of search_results) {
                if (buttons.length >= 5) {
                    break;
                }
                buttons.push([{ text: `${student.name}${student.student}`, callback_data: `modeus_${student.id}` }]);
            }

            if (buttons.length === 0) {
                await ctx
                    .reply(
                        `<b><u>🎓 Профили не найдены</u></b>\n\nПо вашему запросу "${user_name}" профили не найдены. Попробуйте еще раз или напишите @artem2584 для помощи.`,
                        {
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]],
                            },
                        }
                    )
                    .catch((e) => Logger.errorMessage(`Error replying no profiles found: ${e.message}`));
            } else {
                await ctx
                    .reply(
                        `<b><u>🎓 Выбери свой профиль</u></b>\n\nНайдено профилей: <b>${search_results.length}</b> (показано макс. 5).\nЕсли нет твоего профиля, попробуй уточнить ФИО или напиши @artem2584.`,
                        {
                            parse_mode: "HTML",
                            reply_markup: {
                                inline_keyboard: [
                                    ...buttons,
                                    [{ text: "❌ Отмена", callback_data: "reset_listeners" }],
                                ],
                            },
                        }
                    )
                    .catch((e) => Logger.errorMessage(`Error replying with profiles: ${e.message}`));
            }
        } catch (e) {
            Logger.errorMessage(`Error in modeus_listener textHandler: ${e.message} ${e.stack}`);
            await ctx
                .reply("Произошла ошибка при поиске. Попробуйте позже.")
                .catch((e) => Logger.errorMessage(`Error replying search error: ${e.message}`));
        }
    });

    bot.action(/modeus_(.+)/, async (ctx) => {
        const profile_id = ctx.match[1];
        await ctx.answerCbQuery().catch(() => {});
        user_states.set(ctx.from.id, "none");

        await db.saveUserModeus(ctx.from.id, profile_id);

        await ctx
            .editMessageText(
                `<b><u>🎓 Профиль Modeus привязан!</u></b>\n\nТы успешно привязал свой профиль.\nID твоего профиля: <code>${profile_id}</code>`,
                { parse_mode: "HTML" }
            )
            .catch((e) => Logger.errorMessage(`Error editing modeus linked message: ${e.message}`));
    });
}

function registerGoogleSync() {
    bot.command("link_google", (ctx) => {
        ctx.deleteMessage(ctx.message.message_id).catch(() => {});

        let issue_time = Math.floor(new Date().getTime() / 1000);
        // Using your original crypto.hash
        let state = `${ctx.from.id}-${issue_time}-${crypto.hash(
            "sha256",
            `${ctx.from.id}-${issue_time}-${config.credentials.internal}`
        )}`;

        const url = googleOAuth.generateAuthUrl({
            access_type: "offline",
            scope: [
                "https://www.googleapis.com/auth/calendar.app.created",
                "https://www.googleapis.com/auth/calendar.events",
            ],
            state: state,
            prompt: "consent",
        });

        ctx.reply(
            `<b><u>📅 Подключение Google Calendar</u></b>\n\n❗ Бот создаст новый календарь "Modeus Integration" в вашем Google Аккаунте и будет управлять только им.\nВаши существующие календари и события затронуты не будут.\n\n<a href="${url}">➡️ Перейди по этой ссылке, чтобы разрешить доступ.</a>\n\nЕсли не получается привязать аккаунт, напиши @artem2584`,
            { parse_mode: "HTML", disable_web_page_preview: true }
        ).catch((e) => Logger.errorMessage(`Error sending link_google prompt: ${e.message}`));
    });

    setInterval(async () => {
        let login_attempts = await db.getGoogleLoginAttempts();
        if (login_attempts.length === 0) return;

        Logger.infoMessage(`Processing ${login_attempts.length} Google login attempts.`);
        for (const login_attempt of login_attempts) {
            let tg_id = login_attempt.tg_id;
            let code = login_attempt.code;

            let attempt_googleOAuth = new google.auth.OAuth2(
                config.google.client_id,
                config.google.secret_id,
                config.google.redirect
            );

            try {
                const { tokens } = await attempt_googleOAuth.getToken(code);
                await db.deleteLoginAttempts(tg_id);

                if (!tokens || !tokens.refresh_token) {
                    Logger.errorMessage(
                        `Failed to get refresh_token for tg_id ${tg_id}. Tokens: ${JSON.stringify(tokens)}`
                    );
                    await bot.telegram
                        .sendMessage(
                            tg_id,
                            `❌ Не удалось привязать Google! Попробуй привязать ещё раз через /link_google.\nЕсли проблема повторяется, напиши @artem2584.`
                        )
                        .catch((e) => Logger.errorMessage(`Error sending TG message (no refresh token): ${e.message}`));
                    continue;
                }
                await db.saveUserGoogleCalendar(tg_id, tokens.refresh_token);
                Logger.infoMessage(`Successfully obtained and saved refresh_token for tg_id ${tg_id}.`);
                await bot.telegram
                    .sendMessage(
                        tg_id,
                        `✅ Google Calendar был успешно привязан! Расписание начнет синхронизироваться в течение 15-30 минут.`
                    )
                    .catch((e) => Logger.errorMessage(`Error sending TG message (success link): ${e.message}`));
            } catch (err) {
                Logger.errorMessage(
                    `Error exchanging Google token for tg_id ${tg_id}: ${err.message}. Code used: ${
                        code ? code.substring(0, 20) + "..." : "N/A"
                    }`
                );
                await db.deleteLoginAttempts(tg_id);
                let userMessage = `❌ Ошибка при привязке Google Calendar: ${err.message}.\nПопробуй еще раз через /link_google.`;
                if (
                    err.message &&
                    (err.message.includes("invalid_grant") || err.message.includes("code has already been used"))
                ) {
                    userMessage = `❌ Ошибка: код авторизации уже использован или недействителен. Пожалуйста, сгенерируй новую ссылку через /link_google и используй ее сразу.`;
                }
                await bot.telegram
                    .sendMessage(tg_id, userMessage + `\nЕсли не получится, напиши @artem2584.`)
                    .catch((e) => Logger.errorMessage(`Error sending TG message (token exchange error): ${e.message}`));
            }
        }
    }, 15 * 1000);
}

// Launch the bot
bot.launch()
    .then(() => {
        Logger.successMessage("Bot launched successfully.");
    })
    .catch((err) => {
        Logger.errorMessage(`Bot launch error: ${err.message}`);
        process.exit(1);
    });

// Enable graceful stop
process.once("SIGINT", () => {
    Logger.infoMessage("SIGINT received, stopping bot...");
    bot.stop("SIGINT");
    process.exit(0);
});
process.once("SIGTERM", () => {
    Logger.infoMessage("SIGTERM received, stopping bot...");
    bot.stop("SIGTERM");
    process.exit(0);
});
