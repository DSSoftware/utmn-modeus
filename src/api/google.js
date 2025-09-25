const { google } = require("googleapis");
const { RunBatch } = require("gbatchrequests");
const Logger = require("../Logger");
const config = require("../config");

const GOOGLE_API_BATCH_LIMIT = 50;

async function callGoogleApiWithRetry(apiCallFunction, logContext = "", maxRetries = 5, initialDelayMs = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await apiCallFunction();
        } catch (error) {
            lastError = error;
            const statusCode = error.code || error.status;
            
            Logger.warnMessage(
                `Error Code ${statusCode} encountered for ${logContext}. Attempt ${attempt}/${maxRetries}`
            );
            
            // If this is the last attempt, throw the error
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Wait before retrying (exponential backoff)
            const delay = initialDelayMs * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // This should never be reached, but just in case
    throw lastError;
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
    try {
        const { token } = await auth.getAccessToken();
        if (!token) {
            throw new Error('No access token received from Google Auth');
        }
        return token;
    } catch (error) {
        Logger.errorMessage(`Failed to get access token: ${error.message}`);
        throw error;
    }
}

async function batchGet(accessToken, requests, calendarId) {
    try {
        const getChunks = [];
        for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
            getChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
        }

        const responses = [];
        for (let i = 0; i < getChunks.length; i++) {
            const batchGetObj = {
                api: { name: "calendar", version: "v3" },
                accessToken,
                requests: getChunks[i],
                skipError: true,
            };
            try {
                const getBatchResponses = await RunBatch(batchGetObj);
                responses.push(...getBatchResponses);
            } catch (batchError) {
                Logger.errorMessage(`Batch GET error for chunk ${i}: ${batchError.message}`);
                throw batchError;
            }
        }
        return responses;
    } catch (error) {
        Logger.errorMessage(`batchGet failed: ${error.message}`);
        throw error;
    }
}

async function batchDelete(accessToken, requests, calendarId) {
    try {
        const deleteChunks = [];
        for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
            deleteChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
        }

        for (let i = 0; i < deleteChunks.length; i++) {
            const batchDeleteObj = {
                api: { name: "calendar", version: "v3" },
                skipError: true,
                accessToken,
                requests: deleteChunks[i],
            };
            try {
                await RunBatch(batchDeleteObj);
            } catch (batchError) {
                Logger.errorMessage(`Batch DELETE error for chunk ${i}: ${batchError.message}`);
                throw batchError;
            }
        }
    } catch (error) {
        Logger.errorMessage(`batchDelete failed: ${error.message}`);
        throw error;
    }
}

async function batchWrite(accessToken, requests, calendarId) {
    try {
        const writeChunks = [];
        for (let i = 0; i < requests.length; i += GOOGLE_API_BATCH_LIMIT) {
            writeChunks.push(requests.slice(i, i + GOOGLE_API_BATCH_LIMIT));
        }
        const responses = [];
        for (let i = 0; i < writeChunks.length; i++) {
            const batchWriteObj = {
                api: { name: "calendar", version: "v3" },
                skipError: true,
                accessToken,
                requests: writeChunks[i],
            };
            try {
                // Make a copy of the original requests before passing to RunBatch
                const originalRequestsCopy = [...writeChunks[i]];
                
                const writeBatchResponses = await RunBatch(batchWriteObj);
                const responseObj = {responses: writeBatchResponses, originalRequests: originalRequestsCopy};
                responses.push(responseObj);
            } catch (batchError) {
                Logger.errorMessage(`Batch WRITE error for chunk ${i}: ${batchError.message}`);
                throw batchError;
            }
        }
        
        return responses;
    } catch (error) {
        Logger.errorMessage(`batchWrite failed: ${error.message}`);
        throw error;
    }
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