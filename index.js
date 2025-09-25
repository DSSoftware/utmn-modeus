/**
 *  Importing modules
 */
const Logger = require("./src/Logger");
const Database = require("./src/Database");
const { getModeusToken } = require("./src/api/modeus");
const { recheckModeus } = require("./src/services/ModeusService");
const { syncGoogleCalendar } = require("./src/services/googleSyncService");
const { setupBot } = require("./src/bot");

const db = new Database();

async function init() {
    try {
        db.setup();
        await getModeusToken(db);
        Logger.successMessage("Successfully connected to Modeus.");
    } catch (e) {
        Logger.errorMessage(`Unable to get Modeus Access Token. Dying. ${e.message}`);
        throw e;
    }

    const mainTask = async () => {
        await recheckModeus(db);
        await syncGoogleCalendar(db);
    };

    setInterval(mainTask, 15 * 60 * 1000);
    mainTask();

    setupBot(db);
}

init().catch((e) => {
    console.error("Fatal error during initialization:", e);
    process.exit(1);
});
