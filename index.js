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

const bot = new tg.Telegraf(config.credentials.telegram);
let db = new Database();
db.setup();

const googleOAuth = new google.auth.OAuth2(config.google.client_id, config.google.secret_id, config.google.redirect);

let local_token_cache = {
    token: "",
    timestamp: 0,
};

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
                        let place_info = "";

                        if (event_locations[i].customLocation != null) {
                            place_info = event_locations[i].customLocation;
                        } else {
                            let location = location_map.get(event_locations[i]._links["event-rooms"].href.substring(1));
                            let room = rooms.get(location._links.room.href.substring(1));

                            place_info = room.nameShort;
                        }

                        let course_name = courses.get(
                            events[i]._links["cycle-realization"].href.substring(1)
                        ).courseUnitRealizationNameShort;

                        let event_attendees = await getEventAttendees(events[i].id);
                        let attendees_list = [];
                        let teachers = [];
                        for (let event_attendee of event_attendees) {
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

async function init() {
    try {
        await getModeusToken();
        Logger.successMessage("Successfully connected to Modeus.");
    } catch (e) {
        console.log(e);
        Logger.errorMessage("Unable to get Modeus Access Token. Dying.");
        throw "Unable to get Modeus Access Token.";
    }

    setInterval(recheckModeus, 15 * 60 * 1000);
    recheckModeus();

    async function recheckModeus() {
        Logger.infoMessage("Rechecking Modeus Events...");
        let attendees = [];
        let recheck_started = Math.floor(new Date().getTime() / 1000);

        let students_stat = 0;
        let events_stat = 0;

        async function fetchAssociatedEvents(attendee_list) {
            let events = await findModeusEvents(attendee_list);

            let promises = [];
            let threads = 10;
            for (let thread = 0; thread < threads; thread++) {
                promises.push(
                    new Promise(async (resolve, reject) => {
                        for (let i = thread; i < events.length; i += threads) {
                            const event = events[i];
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

                            for (const attendee of attendee_list) {
                                if (!event_object.attendees.includes(attendee)) {
                                    continue;
                                }
                                await db.saveUserEvent(
                                    `${attendee};${event.info.id}`,
                                    attendee,
                                    event.info.id,
                                    recheck_started,
                                    timestamp
                                );
                            }

                            await db.saveEvent(event.info.id, recheck_started, timestamp, JSON.stringify(event_object));
                        }
                        resolve(true);
                    })
                );
            }

            await Promise.all(promises);
        }

        let students = db.getRecheckUsers();

        for await (const attendee of students) {
            if (attendees.length >= 25) {
                await fetchAssociatedEvents(attendees);
                attendees = [];
            }
            attendees.push(attendee.attendee_id);
            students_stat++;
        }
        if (attendees.length != 0) {
            await fetchAssociatedEvents(attendees);
            attendees = [];
        }

        Logger.successMessage("Rechecked Modeus Events.");
        await db.setConfigValue("lastRefresh", recheck_started);

        console.log(`Recheck Stats:\nStudents: ${students_stat}\nEvents: ${events_stat}`);
        console.log(`Recheck Time: ${Math.floor(new Date().getTime() / 1000) - recheck_started} seconds`);

        let monday_timestamp = Math.floor(getDates().start_timestamp / 1000);

        await db.cleanupOldEvents(monday_timestamp, recheck_started);
        await db.cleanupOldStudentEvents(monday_timestamp, recheck_started);

        /*
            Handle Google Calendar Here
        */

        Logger.infoMessage("Syncing with Google Calendar...");
        recheck_started = Math.floor(new Date().getTime() / 1000);

        let logged_attendees = db.getLoggedAttendees();

        const calendarOAuth = new google.auth.OAuth2(
            config.google.client_id,
            config.google.secret_id,
            config.google.redirect
        );

        for await (const calendar_attendee of logged_attendees) {
            try {
                let ca_id = calendar_attendee.attendee_id;
                let calendar_events = await db.getUserEvents(ca_id);
                let calendar_person = (await db.findAttendee(ca_id))[0];

                calendarOAuth.setCredentials({
                    refresh_token: calendar_person.google_token,
                });
                const calendar = google.calendar({ version: "v3", auth: calendarOAuth });

                let app_calendar_id = calendar_person.calendar_id;

                try {
                    if (app_calendar_id == null) {
                        throw {
                            code: 404,
                            message: "Calendar not created",
                        };
                    }
                    let response = await calendar.calendars.get({ calendarId: app_calendar_id });
                } catch (e) {
                    if (e.code === 404) {
                        await db.saveCalendarID(calendar_person.telegram_id, null);
                        app_calendar_id = null;
                    } else {
                        throw e;
                    }
                }

                if (!app_calendar_id) {
                    const newCalendarResponse = await calendar.calendars.insert({
                        requestBody: {
                            summary: "Modeus Integration",
                            timeZone: "Asia/Yekaterinburg",
                        },
                    });

                    app_calendar_id = newCalendarResponse.data.id;
                    await db.saveCalendarID(calendar_person.telegram_id, app_calendar_id);
                }
                let promises = [];
                let threads = 1;
                for (let thread = 0; thread < threads; thread++) {
                    promises.push(
                        new Promise(async (resolve, reject) => {
                            for (let i = thread; i < calendar_events.length; i += threads) {
                                const calendar_event = calendar_events[i];
                                try {
                                    let event_id = calendar_event.event_id;
                                    let event_record = await db.getEvent(event_id);
            
                                    let event_data = JSON.parse(event_record[0].event_data);
            
                                    let sas_event = event_data.name.match(/\d.\d/g);
            
                                    let event_name = `${event_data.name} / ${event_data.course}`;
                                    let type = event_data.typeId === "LECT" ? "L" : "S";
                                    let color = event_data.typeId === "LECT" ? 10 : 1;
            
                                    if (sas_event != null) {
                                        event_name = `${sas_event}${type} / ${event_data.course}`;
                                    }
            
                                    let professor_list = `Преподаватели:\n${event_data.teachers.join("\n") || "Не указаны"}`;
                                    let attendee_teachers = [];
            
                                    /*for (const teacher of event_data.teachers) {
                                        attendee_teachers.push({
                                            displayName: teacher,
                                            email: "modeus_integration@dssoftware.ru"
                                        });
                                    }*/
            
                                    const eventResource = {
                                        summary: event_name,
                                        description: `Курс: ${event_data.course}\n${event_data.name}\nУчастники: ${
                                            event_data.attendees.length - event_data.teachers.length
                                        } участников\n\n${professor_list}`,
                                        start: {
                                            dateTime: event_data.start, // RFC3339
                                            timeZone: "Asia/Yekaterinburg",
                                        },
                                        end: {
                                            dateTime: event_data.end, // RFC3339
                                            timeZone: "Asia/Yekaterinburg",
                                        },
                                        location: event_data.room,
                                        attendees: attendee_teachers,
                                        colorId: color,
                                    };
            
                                    async function createCalendarEvent() {
                                        const storedGoogleEvents = await db.findCalendarEvent(event_id);
            
                                        let storedGoogleEventId = null;
                                        if (storedGoogleEvents.length != 0) {
                                            storedGoogleEventId = storedGoogleEvents[0].calendar_id;
                                        }
            
                                        if (storedGoogleEventId) {
                                            try {
                                                const updatedEvent = await calendar.events.update({
                                                    calendarId: app_calendar_id,
                                                    eventId: storedGoogleEventId,
                                                    requestBody: eventResource,
                                                });
                                                return storedGoogleEventId;
                                            } catch (error) {
                                                if (error.code === 404 || (error.response && error.response.status === 404)) {
                                                    await db.deleteCalendarEvent(event_id);
                                                } else if (error.code === 410) {
                                                    await db.deleteCalendarEvent(event_id);
                                                } else {
                                                    throw error;
                                                }
                                            }
                                        }
            
                                        try {
                                            const createdEvent = await calendar.events.insert({
                                                calendarId: app_calendar_id,
                                                requestBody: eventResource,
                                            });
            
                                            return createdEvent.data.id;
                                        } catch (error) {
                                            throw error;
                                        }
                                    }
            
                                    let timestamp = new Date(event_data.start).getTime() / 1000;
                                    let google_event_id = await createCalendarEvent();
                                    await db.saveCalendarEvent(event_id, google_event_id, timestamp);
                                } catch (e) {
                                    console.log(e);
                                }
                            }
                            setTimeout(resolve, 100);
                        })
                    )
                }
                
                await Promise.all(promises);
            } catch (e) {
                console.log(e);
            }
        }

        Logger.successMessage("Reassigned Google Calendar Events.");
        console.log(`Google Time: ${Math.floor(new Date().getTime() / 1000) - recheck_started} seconds`);
    }
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

bot.action(/reset_listeners/, async (ctx) => {
    await ctx.answerCbQuery();
    user_states.set(ctx.from.id, "none");
    await ctx.deleteMessage(ctx.callbackQuery?.message?.message_id);
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
        );
    }

    bot.command("info", (ctx) => {
        (async () => {
            ctx.deleteMessage(ctx.message.message_id);

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
                console.log(last_refresh[0].value);
                let rd = new Date((last_refresh[0].value * 1000) + (5 * 60 * 60 * 1000));

                relative_refresh = `${day(rd)}.${month(rd)}.${year(rd)} ${hour(rd)}:${minute(rd)}`;
            }

            ctx.reply(
                `<b><u>👤 Информация</u></b>\n\n<u>🔗 Профили</u>\nПрофиль Modeus: <b>${
                    linked_modeus ? "✅ Привязан" : "❌ Не привязан"
                }</b>\nПрофиль Google: <b>${linked_google ? "✅ Привязан" : "❌ Не привязан"}</b>\n\nНастройка: <b>${
                    can_refresh ? "✅ Готово к работе" : "❌ Один из профилей не привязан"
                }</b>\n\n<u>🔁 Последнее обновление</u>\nСписок событий обновлён <u>${relative_refresh}</u>`,
                {
                    parse_mode: "HTML",
                }
            );
        })();
    });

    bot.start((ctx) => {
        ctx.deleteMessage(ctx.message.message_id);
        sendHelpDialog(ctx);
    });

    bot.help((ctx) => {
        ctx.deleteMessage(ctx.message.message_id);
        sendHelpDialog(ctx);
    });
}

function registerModeusSync() {
    bot.command("link_modeus", (ctx) => {
        ctx.deleteMessage(ctx.message.message_id);
        ctx.reply(
            `<b><u>🎓 Подключение Modeus</u></b>\n\nВведи полное ФИО в таком порядке:\n<code>Иванов Иван Иванович</code>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]],
                },
            }
        );
        user_states.set(ctx.from.id, "modeus_listener");
    });

    textHandlers.push(async (ctx) => {
        async function executeLogic() {
            if (user_states.get(ctx.from.id) != "modeus_listener") {
                return;
            }

            let user_name = ctx.message.text;
            let search_results = await findModeusUser(user_name);

            let buttons = [];

            for (const student of search_results) {
                if (buttons.length >= 5) {
                    continue;
                }
                buttons.push([{ text: `${student.name}${student.student}`, callback_data: `modeus_${student.id}` }]);
            }

            ctx.reply(
                `<b><u>🎓 Выбери свой профиль</u></b>\n\nВыбери свой профиль из <b>${search_results.length}</b> доступных.\nЕсли нет твоего профиля, напиши @artem2584`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: buttons,
                    },
                }
            );
        }
        executeLogic();
    });

    bot.action(/modeus_(.+)/, async (ctx) => {
        const profile_id = ctx.match[1];
        await ctx.answerCbQuery();

        await db.saveUserModeus(ctx.from.id, profile_id);

        ctx.reply(
            `<b><u>🎓 Профиль Modeus привязан!</u></b>\n\nТы успешно привязал свой профиль.\nID твоего профиля: <code>${profile_id}</code>`,
            {
                parse_mode: "HTML",
            }
        );
    });
}

function registerGoogleSync() {
    bot.command("link_google", (ctx) => {
        ctx.deleteMessage(ctx.message.message_id);

        let issue_time = Math.floor(new Date().getTime() / 1000);

        let state = `${ctx.from.id}-${issue_time}-${crypto.hash(
            "sha256",
            `${ctx.from.id}-${issue_time}-${config.credentials.internal}`
        )}`;

        const url = googleOAuth.generateAuthUrl({
            access_type: "offline",
            scope: "https://www.googleapis.com/auth/calendar.app.created",
            state: state,
        });

        ctx.reply(
            `<b><u>📅 Подключение Google Calendar</u></b>\n\n❗ Добавлю новый календарь только для событий из Modeus.\nВсё будет работать точно также, но твои события не будут перезаписаны.\nЕсли не получается привязать аккаунт, напиши @artem2584\n\n<a href="${url}">Перейди по ссылке, чтобы привязать аккаунт.</a>`,
            {
                parse_mode: "HTML",
            }
        );
    });

    setInterval(async () => {
        let login_attempts = await db.getGoogleLoginAttempts();

        for (const login_attempt of login_attempts) {
            let tg_id = login_attempt.tg_id;
            let code = login_attempt.code;

            googleOAuth.getToken(code, async (err, tokens) => {
                try {
                    await db.deleteLoginAttempts(tg_id);
                    if (err || tokens?.refresh_token == undefined) {
                        await bot.telegram.sendMessage(
                            tg_id,
                            `❌ Не удалось привязать Google! Попробуй привязать ещё раз с новой ссылкой.\nЕсли не получится, напиши @artem2584`
                        );
                        return;
                    }

                    let refresh_token = tokens.refresh_token;

                    await db.saveUserGoogleCalendar(tg_id, refresh_token);

                    await bot.telegram.sendMessage(tg_id, `✅ Google Calendar был успешно привязан!`);
                } catch (e) {
                    console.log(e);
                }
            });
        }
    }, 15 * 1000);

    bot.action(/modeus_(.+)/, async (ctx) => {
        const profile_id = ctx.match[1];
        await ctx.answerCbQuery();

        await db.saveUserModeus(ctx.from.id, profile_id);

        ctx.reply(
            `<b><u>🎓 Профиль Modeus привязан!</u></b>\n\nВы успешно привязали ваш профиль.\nID вашего профиля: <code>${profile_id}</code>`,
            {
                parse_mode: "HTML",
            }
        );
    });
}

// Launch the bot
bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
