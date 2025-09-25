const { google } = require("googleapis");
const { RunBatch } = require("gbatchrequests");
const Logger = require("../Logger");
const config = require("../config");

const GOOGLE_API_BATCH_LIMIT = 50;

async function callGoogleApiWithRetry(apiCallFunction, logContext = "", maxRetries = 5, initialDelayMs = 1000) {
    try {
        return await apiCallFunction();
    } catch (error) {
        const statusCode = error.code;
        Logger.warnMessage(
            `Error Code ${statusCode} encountered for ${logContext}.`
        );
    }
}

function getGoogleAuth() {
    return new google.auth.OAuth2(config.google.client_id, config.google.secret_id, config.google.redirect);
}

async function getCalendar(auth, calendarId) {
    const calendar = google.calendar({ version: "v3", auth });
    return await callGoogleApiWithRetry(
        () => calendar.calendars.get({ calendarId }),
        `get calendar ${calendarId}`
    );
}

async function createCalendar(auth) {
    const calendar = google.calendar({ version: "v3", auth });
    const newCal = await callGoogleApiWithRetry(
        () =>
            calendar.calendars.insert({
                requestBody: { summary: "Modeus Integration", timeZone: "Asia/Yekaterinburg" },
            }),
        `insert calendar`
    );
    return newCal.data.id;
}

async function getAccessToken(auth) {
    const { token } = await auth.getAccessToken();
    return token;
}

async function batchGet(accessToken, requests, calendarId) {
    const getChunks = [];
    for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
        getChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
    }

    const responses = [];
    for (let i = 0; i < getChunks.length; i++) {
        const batchGetObj = {
            accessToken,
            requests: getChunks[i],
        };
        const getBatchResponses = await RunBatch(batchGetObj);
        responses.push(...getBatchResponses);
    }
    return responses;
}

async function batchDelete(accessToken, requests, calendarId) {
    const deleteChunks = [];
    for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
        deleteChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
    }

    for (let i = 0; i < deleteChunks.length; i++) {
        const batchDeleteObj = {
            accessToken,
            requests: deleteChunks[i],
        };
        await RunBatch(batchDeleteObj);
    }
}

async function batchWrite(accessToken, requests, calendarId) {
    const writeChunks = [];
    for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
        writeChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
    }
    const responses = [];
    for (let i = 0; i < writeChunks.length; i++) {
        const batchWriteObj = {
            accessToken,
            requests: writeChunks[i],
        };
        const writeBatchResponses = await RunBatch(batchWriteObj);
        responses.push({responses: writeBatchResponses, originalRequests: writeChunks[i]});
    }
    return responses;
}

async function deleteCalendar(auth, calendarId) {
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.calendars.delete({ calendarId }).catch((e) => {
        console.log(e);
    });
}


module.exports = {
    getGoogleAuth,
    getCalendar,
    createCalendar,
    getAccessToken,
    batchGet,
    batchDelete,
    batchWrite,
    deleteCalendar
};