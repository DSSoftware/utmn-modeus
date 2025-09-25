const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/Logger");
const config = require("../utils/ConfigManager");

/**
 * Service for interacting with Modeus API
 */
class ModeusService {
    constructor(database) {
        this.database = database;
        this.tokenCache = {
            token: "",
            timestamp: 0,
        };
        this.appConfig = config.get('app');
        this.modeusConfig = config.get('modeus');
        this.credentials = config.get('credentials');
    }

    /**
     * Get Modeus access token with caching
     */
    async getToken() {
        const now = Math.floor(Date.now() / 1000);
        const tokenExpiry = 60 * 60; // 1 hour
        
        // Check memory cache first
        if (this.tokenCache.token && (now - this.tokenCache.timestamp) < tokenExpiry) {
            return this.tokenCache.token;
        }

        // Check database cache
        try {
            const cachedToken = await this.database.getConfigValue("modeus_token", 12 * 60 * 60);
            if (cachedToken.length > 0 && cachedToken[0].value) {
                logger.info("Using cached Modeus token");
                this.tokenCache.token = cachedToken[0].value;
                this.tokenCache.timestamp = now;
                return cachedToken[0].value;
            }
        } catch (error) {
            logger.warn("Failed to retrieve cached token from database");
        }

        // Fetch new token
        logger.info("Fetching new Modeus token");
        const token = await this.fetchNewToken();
        
        // Cache the token
        this.tokenCache.token = token;
        this.tokenCache.timestamp = now;
        await this.database.setConfigValue("modeus_token", token);
        
        return token;
    }

    /**
     * Fetch new access token from Modeus
     */
    async fetchNewToken() {
        try {
            const nonce = crypto.randomBytes(20).toString("hex");

            // Step 1: Initial OAuth request
            const authResponse = await this.makeAuthRequest(nonce);
            const { location: fsLocation, cookie: tc01Cookie } = this.extractAuthData(authResponse);

            // Step 2: FS authentication
            const fsResponse = await this.makeRequest(fsLocation, {
                headers: {
                    "User-Agent": this.getUserAgent(),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "ru-RU,ru;q=0.9",
                    "Referer": `${this.modeusConfig.base_url}/`,
                }
            });

            // Step 3: Login to FS
            const { sessionCookie, loginUrl } = this.extractFSData(fsResponse);
            const accessToken = await this.performLogin(loginUrl, sessionCookie, tc01Cookie);

            if (!accessToken) {
                throw new Error("Unable to obtain access token");
            }

            logger.success("Successfully obtained Modeus access token");
            return accessToken;

        } catch (error) {
            logger.error("Failed to fetch Modeus token", error);
            throw error;
        }
    }

    /**
     * Make initial OAuth authorization request
     */
    async makeAuthRequest(nonce) {
        return await this.makeRequest(`${this.modeusConfig.auth_url}/oauth2/authorize`, {
            params: {
                response_type: "id_token token",
                client_id: "sKir7YQnOUu4G0eCfn3tTxnBfzca",
                state: nonce,
                nonce: nonce,
                redirect_uri: `${this.modeusConfig.base_url}/schedule-calendar/`,
                scope: "openid",
            },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });
    }

    /**
     * Extract authentication data from response
     */
    extractAuthData(response) {
        const location = response.request?.res?.headers?.location;
        const cookies = response.request?.res?.headers?.["set-cookie"];
        const cookie = cookies?.[0]?.split(";")[0];
        
        if (!location || !cookie) {
            throw new Error("Failed to extract authentication data");
        }

        return { location, cookie };
    }

    /**
     * Extract FS authentication data
     */
    extractFSData(response) {
        const cookies = response.request?.res?.headers?.["set-cookie"];
        const sessionCookie = cookies?.[0]?.split(";")[0];
        
        const loginMatch = response.data.match(/method="post" action="(https:\/\/fs\.utmn\.ru:443\/adfs\/ls\?.*?)"/);
        const loginUrl = loginMatch?.[1];

        if (!sessionCookie || !loginUrl) {
            throw new Error("Failed to extract FS authentication data");
        }

        return { sessionCookie, loginUrl };
    }

    /**
     * Perform login with credentials
     */
    async performLogin(loginUrl, sessionCookie, tc01Cookie) {
        const authString = `UserName=${encodeURIComponent(this.credentials.utmn.login)}&Password=${encodeURIComponent(this.credentials.utmn.password)}&AuthMethod=FormsAuthentication`;

        // Login request
        const loginResponse = await this.makeRequest(loginUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": authString.length,
                "Cookie": sessionCookie,
                "User-Agent": this.getUserAgent(),
                "Referer": loginUrl,
            },
            data: authString,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });

        // Process SAML response
        return await this.processSAMLResponse(loginResponse, tc01Cookie);
    }

    /**
     * Process SAML response and extract access token
     */
    async processSAMLResponse(loginResponse, tc01Cookie) {
        const location = loginResponse.request?.res?.headers?.location;
        const msisAuthCookie = loginResponse.request?.res?.headers?.["set-cookie"]?.[0]?.split(";")[0];

        if (!location || !msisAuthCookie) {
            throw new Error("Failed to get SAML redirect");
        }

        const samlResponse = await this.makeRequest(location, {
            headers: {
                "Cookie": `${msisAuthCookie}; ${tc01Cookie}`,
                "User-Agent": this.getUserAgent(),
            }
        });

        const samlData = this.extractSAMLData(samlResponse.data);
        return await this.exchangeSAMLForToken(samlData, tc01Cookie);
    }

    /**
     * Extract SAML data from response
     */
    extractSAMLData(html) {
        const samlResponse = html.match(/<input type="hidden" name="SAMLResponse" value="(.*?)" \/>/)?.[1];
        const relayState = html.match(/<input type="hidden" name="RelayState" value="(.*?)" \/>/)?.[1];

        if (!samlResponse || !relayState) {
            throw new Error("Failed to extract SAML data");
        }

        return { samlResponse, relayState };
    }

    /**
     * Exchange SAML response for access token
     */
    async exchangeSAMLForToken(samlData, tc01Cookie) {
        const samlString = `SAMLResponse=${encodeURIComponent(samlData.samlResponse)}&RelayState=${encodeURIComponent(samlData.relayState)}`;

        const samlResponse = await this.makeRequest(`${this.modeusConfig.auth_url}/commonauth`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": samlString.length,
                "Cookie": tc01Cookie,
                "User-Agent": this.getUserAgent(),
                "Referer": this.modeusConfig.fs_url,
            },
            data: samlString,
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });

        const finalLocation = samlResponse.request?.res?.headers?.location;
        const accessToken = finalLocation?.match(/id_token=(.*?)&/)?.[1];

        if (!accessToken) {
            throw new Error("Failed to extract access token from final response");
        }

        return accessToken;
    }

    /**
     * Search for users in Modeus
     */
    async findUser(name) {
        try {
            const token = await this.getToken();
            const response = await this.makeRequest(
                `${this.modeusConfig.base_url}/schedule-calendar-v2/api/people/persons/search`,
                {
                    method: "POST",
                    data: {
                        fullName: name,
                        page: 0,
                        size: 5,
                        sort: "+fullName",
                    },
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            return this.formatUserSearchResults(response.data);
        } catch (error) {
            logger.error("Failed to search for user in Modeus", error);
            return [];
        }
    }

    /**
     * Format user search results
     */
    formatUserSearchResults(data) {
        const searchResult = data._embedded;
        const studentsToShow = [];

        for (const user of searchResult?.persons ?? []) {
            const studentInfo = this.getStudentInfo(user.id, searchResult?.students ?? []);
            studentsToShow.push({
                name: user.fullName,
                id: user.id,
                student: studentInfo,
            });
        }

        return studentsToShow;
    }

    /**
     * Get student info for a user
     */
    getStudentInfo(userId, students) {
        for (const studentProfile of students) {
            if (studentProfile.personId === userId) {
                return ` (${studentProfile.flowCode.substring(0, 4)} | ${studentProfile.specialtyCode})`;
            }
        }
        return "";
    }

    /**
     * Get event attendees
     */
    async getEventAttendees(eventId) {
        try {
            const token = await this.getToken();
            const response = await this.makeRequest(
                `${this.modeusConfig.base_url}/schedule-calendar-v2/api/calendar/events/${eventId}/attendees`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            return response.data;
        } catch (error) {
            logger.error(`Failed to get event attendees for event ${eventId}`, error);
            return [];
        }
    }

    /**
     * Find events for attendees
     */
    async findEvents(attendees) {
        try {
            const dates = this.getDateRange();
            const token = await this.getToken();

            const response = await this.makeRequest(
                `${this.modeusConfig.base_url}/schedule-calendar-v2/api/calendar/events/search?tz=${this.modeusConfig.timezone}`,
                {
                    method: "POST",
                    data: {
                        attendeePersonId: attendees,
                        size: 1000,
                        timeMin: dates.start,
                        timeMax: dates.end,
                    },
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            return await this.processEvents(response.data);
        } catch (error) {
            logger.error("Failed to find events in Modeus", error);
            return [];
        }
    }

    /**
     * Process events with parallel attendee fetching
     */
    async processEvents(data) {
        const events = data._embedded?.events ?? [];
        const eventLocations = data._embedded["event-locations"];
        const locationMap = new Map();
        const roomsMap = new Map();
        const coursesMap = new Map();

        // Build lookup maps
        for (const location of data._embedded["event-rooms"]) {
            locationMap.set(location.id, location);
        }

        for (const room of data._embedded["rooms"]) {
            roomsMap.set(room.id, room);
        }

        for (const course of data._embedded["cycle-realizations"]) {
            coursesMap.set(course.id, course);
        }

        // Process events with controlled concurrency
        const processedEvents = await this.processEventsInBatches(
            events,
            eventLocations,
            locationMap,
            roomsMap,
            coursesMap
        );

        return processedEvents;
    }

    /**
     * Process events in parallel batches
     */
    async processEventsInBatches(events, eventLocations, locationMap, roomsMap, coursesMap) {
        const batchSize = this.appConfig.threads_count;
        const processedEvents = [];

        for (let i = 0; i < events.length; i += batchSize) {
            const batch = events.slice(i, i + batchSize);
            const batchPromises = batch.map((event, index) =>
                this.processEvent(
                    event,
                    eventLocations[i + index],
                    locationMap,
                    roomsMap,
                    coursesMap
                )
            );

            const batchResults = await Promise.allSettled(batchPromises);
            
            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value) {
                    processedEvents.push(result.value);
                } else if (result.status === 'rejected') {
                    logger.warn(`Failed to process event: ${result.reason?.message || 'Unknown error'}`);
                }
            }
        }

        return processedEvents;
    }

    /**
     * Process individual event
     */
    async processEvent(event, eventLocation, locationMap, roomsMap, coursesMap) {
        try {
            // Get place info
            let placeInfo = "";
            if (eventLocation?.customLocation) {
                placeInfo = eventLocation.customLocation;
            } else {
                const locationId = eventLocation?._links?.["event-rooms"]?.href?.substring(1);
                const location = locationMap.get(locationId);
                const roomId = location?._links?.room?.href?.substring(1);
                const room = roomsMap.get(roomId);
                placeInfo = room?.nameShort ?? "N/A";
            }

            // Get course name
            const courseId = event._links?.["cycle-realization"]?.href?.substring(1);
            const courseName = coursesMap.get(courseId)?.courseUnitRealizationNameShort || "";

            // Get event attendees
            const eventAttendeesData = await this.getEventAttendees(event.id);
            const attendeesList = [];
            const teachers = [];

            for (const eventAttendee of eventAttendeesData) {
                attendeesList.push(eventAttendee.personId);
                if (eventAttendee.roleId !== "STUDENT") {
                    teachers.push(eventAttendee.fullName);
                }
            }

            return {
                info: event,
                room_name: placeInfo,
                course: courseName,
                attendee_list: attendeesList,
                teachers: teachers,
            };
        } catch (error) {
            logger.error(`Error processing event ${event.id}`, error);
            return null;
        }
    }

    /**
     * Get date range for current week + 3 weeks
     */
    getDateRange() {
        const firstMonday = 4 * 24 * 60 * 60 * 1000;
        const timestamp = Date.now();
        const diff = (timestamp - firstMonday) % (7 * 24 * 60 * 60 * 1000);

        const startTimestamp = timestamp - diff - 5 * 60 * 60 * 1000;
        const endTimestamp = startTimestamp + 3 * 7 * 24 * 60 * 60 * 1000;

        const startDate = new Date(startTimestamp);
        const endDate = new Date(endTimestamp);

        return {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp,
        };
    }

    /**
     * Make HTTP request with retry logic
     */
    async makeRequest(url, options = {}, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await axios(url, options);
            } catch (error) {
                if (attempt === retries) {
                    throw error;
                }
                await this.delay(1000 * attempt);
            }
        }
    }

    /**
     * Get user agent string
     */
    getUserAgent() {
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ModeusService;