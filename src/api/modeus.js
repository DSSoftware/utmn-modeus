const axios = require("axios");
const crypto = require("crypto");
const config = require("../config");
const Logger = require("../Logger");
const { getDates } = require("../utils/date");

let local_token_cache = {
    token: "",
    timestamp: 0,
};

async function getModeusToken(db) {
    if (local_token_cache.token != "") {
        if (local_token_cache.timestamp >= new Date().getTime() / 1000 - 1 * 60 * 60) {
            return local_token_cache.token;
        }
    }

    let token = await fetchModeusToken(db);
    local_token_cache.token = token;
    local_token_cache.timestamp = Math.floor(new Date().getTime() / 1000);

    return token;
}

async function fetchModeusToken(db) {
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

    const utmnLogin = config.credentials.utmn.login;
    const utmnPassword = config.credentials.utmn.password;

    if (!utmnLogin || !utmnPassword) {
        throw new Error("UTMN login or password is not defined in the configuration.");
    }

    let auth_string = `UserName=${encodeURIComponent(utmnLogin)}&Password=${encodeURIComponent(
        utmnPassword
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

async function findModeusUser(name, db) {
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
                Authorization: `Bearer ${await getModeusToken(db)}`,
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
        Logger.errorMessage(`Error in findModeusUser for name ${name}: ${e.message}`);
        return [];
    }
}

async function getEventAttendees(event_id, db) {
    try {
        let request = await axios({
            method: "GET",
            url: `https://utmn.modeus.org/schedule-calendar-v2/api/calendar/events/${event_id}/attendees`,
            headers: {
                Authorization: `Bearer ${await getModeusToken(db)}`,
            },
        });

        return request.data;
    } catch (e) {
        Logger.errorMessage(`Error in getEventAttendees for event ${event_id}: ${e.message}`);
        return [];
    }
}

async function findModeusEvents(attendees, db) {
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
                Authorization: `Bearer ${await getModeusToken(db)}`,
            },
        });

        let prep_events = [];

        let event_locations = request.data._embedded["event-locations"];
        let events = request.data._embedded.events ?? [];

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

                            if (event_locations[i]?.customLocation) {
                                place_info = event_locations[i].customLocation;
                            } else {
                                let location = location_map.get(
                                    (event_locations[i]._links["event-rooms"]?.href ?? "").substring(1)
                                );
                                let room = rooms.get((location?._links?.room?.href ?? "").substring(1));
                                place_info = room?.nameShort ?? "N/A";
                            }

                            let course_name = courses.get(
                                (events[i]?._links?.["cycle-realization"]?.href ?? "").substring(1)
                            )?.courseUnitRealizationNameShort || "";

                            let event_attendees_data = await getEventAttendees(events[i].id, db);
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
        Logger.errorMessage(`Error in findModeusEvents: ${e.message}`);
        return [];
    }
}

module.exports = {
    getModeusToken,
    findModeusUser,
    findModeusEvents,
    getEventAttendees
}