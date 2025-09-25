const mysql = require("mysql2/promise");
const config = require("../config");
const Logger = require("./Logger");

module.exports = class DatabaseHandler {
    /** @type {import('mysql2/promise').Pool | null} */
    connection = null;

    connect() {
        this.connection = mysql.createPool({
            host: config.database.hostname,
            port: config.database.port ? parseInt(config.database.port, 10) : 3306,
            user: config.database.login,
            password: config.database.password,
            database: config.database.dbname,

            waitForConnections: true,
            connectionLimit: 20,
            maxIdle: 10,
            idleTimeout: 60000,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
        });
        Logger.successMessage("Successfully connected to the Database.");
    }

    async runRawSQL(sql) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.query(sql);
            return true;
        } catch (err) {
            Logger.errorMessage(`Error in runRawSQL: ${err.message}`);
            return false;
        }
    }

    async setup() {
        this.connect();
    }

    async setConfigValue(key, value) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            let timestamp = Math.floor(new Date().getTime()/1000);
            await this.connection.execute("INSERT INTO config (`key`, `value`, `timestamp`) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE `value`=?, `timestamp`=?", [key, value, timestamp, value, timestamp]);
        } catch (err) {
            Logger.errorMessage(`Error in setConfigValue for key ${key}: ${err.message}`);
            throw err;
        }
    }

    async getConfigValue(key, expiration=0) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            let ts_valid = 0;
            if(expiration != 0){
                ts_valid = Math.floor(new Date().getTime()/1000) - expiration;
            }
            const [results, fields] = await this.connection.execute("SELECT * FROM config WHERE `key`=? AND `timestamp` >= ?", [
                key, ts_valid
            ]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getConfigValue for key ${key}: ${err.message}`);
            throw err;
        }
    }

    async createUser(tg_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT IGNORE INTO students (`telegram_id`) VALUES(?)", [tg_id]);
        } catch (err) {
            Logger.errorMessage(`Error in createUser for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async saveUserModeus(tg_id, modeus_profile) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO students (`telegram_id`, `attendee_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `attendee_id`=?", [tg_id, modeus_profile, modeus_profile]);

        } catch (err) {
            Logger.errorMessage(`Error in saveUserModeus for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async getGoogleLoginAttempts() {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT `code`, `tg_id` FROM google_auth GROUP BY `tg_id`", []);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getGoogleLoginAttempts: ${err.message}`);
            throw err;
        }
    }

    async deleteLoginAttempts(tg_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("DELETE FROM google_auth WHERE `tg_id`=?", [tg_id]);

        } catch (err) {
            Logger.errorMessage(`Error in deleteLoginAttempts for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async saveUserGoogleCalendar(tg_id, google_calendar_token) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO students (`telegram_id`, `google_token`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `google_token`=?", [tg_id, google_calendar_token, google_calendar_token]);

        } catch (err) {
            Logger.errorMessage(`Error in saveUserGoogleCalendar for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async saveCalendarID(tg_id, calendar_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO students (`telegram_id`, `calendar_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?", [tg_id, calendar_id, calendar_id]);

        } catch (err) {
            Logger.errorMessage(`Error in saveCalendarID for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async getUserInfo(tg_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM students WHERE `telegram_id`=?", [tg_id]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getUserInfo for user ${tg_id}: ${err.message}`);
            throw err;
        }
    }

    async *getRecheckUsers() {
        if (!this.connection) throw new Error("Database not connected");
        const sql = "SELECT * FROM students WHERE `attendee_id` IS NOT NULL AND `google_token` IS NOT NULL";
        try {
            const [rows] = await this.connection.query(sql);
            for (const row of rows) {
                yield row;
            }
        } catch (err) {
            Logger.errorMessage(`Error in getRecheckUsers: ${err.message}`);
            throw err;
        }
    }
    
    async *getLoggedAttendees() {
        if (!this.connection) throw new Error("Database not connected");
        const sql = "SELECT `attendee_id` FROM student_events GROUP BY `attendee_id`";
        try {
            const [rows] = await this.connection.query(sql);
            for (const row of rows) {
                yield row;
            }
        } catch (err) {
            Logger.errorMessage(`Error in getLoggedAttendees: ${err.message}`);
            throw err;
        }
    }

    async findAttendee(attendee_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM students WHERE `attendee_id`=?", [attendee_id]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in findAttendee for attendee ${attendee_id}: ${err.message}`);
            throw err;
        }
    }

    async getUserEvents(attendee_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM student_events WHERE `attendee_id`=?", [attendee_id]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getUserEvents for attendee ${attendee_id}: ${err.message}`);
            throw err;
        }
    }

    async getEvent(event_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM events WHERE `event_id`=?", [event_id]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getEvent for event ${event_id}: ${err.message}`);
            throw err;
        }
    }

    async getEvents(event_ids) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const placeholder = event_ids.map(() => '?').join(',');
            const [results, fields] = await this.connection.execute(`SELECT * FROM events WHERE event_id IN (${placeholder})`, event_ids);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in getEvents for events ${event_ids.join(',')}: ${err.message}`);
            throw err;
        }
    }

    async findCalendarEventsForUser(user_modeus_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM `calendar_events` WHERE `modeus_id` LIKE ?", [`%-${user_modeus_id}`]);
            return results;
        } catch (err) {
            Logger.errorMessage(`Error in findCalendarEventsForUser for user ${user_modeus_id}: ${err.message}`);
            throw err;
        }
    }

    async saveEvent(event_id, recheck, timestamp, data) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO events (`event_id`, `last_update`, `timestamp`, `event_data`) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE `last_update`=?, `timestamp`=?, `event_data`=?", [event_id, recheck, timestamp, data, recheck, timestamp, data]);
        } catch (err) {
            Logger.errorMessage(`Error in saveEvent for event ${event_id}: ${err.message}`);
            throw err;
        }
    }

    async saveUserEvent(event, attendee, event_id, recheck, timestamp) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO student_events (`event`, `attendee_id`, `event_id`, `last_update`, `timestamp`) VALUES(?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `attendee_id`=?, `event_id`=?, `last_update`=?, `timestamp`=?", [event, attendee, event_id, recheck, timestamp, attendee, event_id, recheck, timestamp]);
        } catch (err) {
            Logger.errorMessage(`Error in saveUserEvent for event ${event_id} and attendee ${attendee}: ${err.message}`);
            throw err;
        }
    }

    async saveCalendarEvent(modeus_id, calendar_id, timestamp) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("INSERT INTO calendar_events (`modeus_id`, `calendar_id`, `timestamp`) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?, `timestamp`=?", [modeus_id, calendar_id, timestamp, calendar_id, timestamp]);
        } catch (err) {
            Logger.errorMessage(`Error in saveCalendarEvent for modeus_id ${modeus_id}: ${err.message}`);
            throw err;
        }
    }

    async findCalendarEvent(modeus_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM calendar_events WHERE `modeus_id`=?", [modeus_id]);

            return results;
        } catch (err) {
            Logger.errorMessage(`Error in findCalendarEvent for modeus_id ${modeus_id}: ${err.message}`);
            throw err;
        }
    }

    async deleteCalendarEvent(modeus_id) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("DELETE FROM calendar_events WHERE `modeus_id`=?", [modeus_id]);
        } catch (err) {
            Logger.errorMessage(`Error in deleteCalendarEvent for modeus_id ${modeus_id}: ${err.message}`);
            throw err;
        }
    }

    async cleanupOldEvents(timestamp, recheck) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("DELETE FROM events WHERE `timestamp`<? AND `last_update`<?", [timestamp, recheck]);
        } catch (err) {
            Logger.errorMessage(`Error in cleanupOldEvents: ${err.message}`);
            throw err;
        }
    }

    async cleanupOldStudentEvents(timestamp, recheck) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("DELETE FROM student_events WHERE `timestamp`<? AND `last_update`<?", [timestamp, recheck]);
        } catch (err) {
            Logger.errorMessage(`Error in cleanupOldStudentEvents: ${err.message}`);
            throw err;
        }
    }

    async executeBatch(sql, params) {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute(sql, params);
        } catch (err) {
            Logger.errorMessage(`Error in executeBatch: ${err.message}`);
            throw err;
        }
    }

    async batchSaveEvents(eventDataArray) {
        if (!this.connection) throw new Error("Database not connected");
        if (eventDataArray.length === 0) return;
        
        try {
            const placeholders = eventDataArray.map(() => '(?, ?, ?, ?)').join(', ');
            const flatParams = eventDataArray.flat();
            const sql = `INSERT INTO events (event_id, last_update, timestamp, event_data) VALUES ${placeholders} 
                         ON DUPLICATE KEY UPDATE last_update=VALUES(last_update), timestamp=VALUES(timestamp), event_data=VALUES(event_data)`;
            
            await this.connection.execute(sql, flatParams);
            Logger.infoMessage(`Batch saved ${eventDataArray.length} events`);
        } catch (err) {
            Logger.errorMessage(`Error in batchSaveEvents: ${err.message}`);
            throw err;
        }
    }

    async batchSaveUserEvents(userEventDataArray) {
        if (!this.connection) throw new Error("Database not connected");
        if (userEventDataArray.length === 0) return;
        
        try {
            const placeholders = userEventDataArray.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const flatParams = userEventDataArray.flat();
            const sql = `INSERT INTO student_events (event, attendee_id, event_id, last_update, timestamp) VALUES ${placeholders} 
                         ON DUPLICATE KEY UPDATE attendee_id=VALUES(attendee_id), event_id=VALUES(event_id), last_update=VALUES(last_update), timestamp=VALUES(timestamp)`;
            
            await this.connection.execute(sql, flatParams);
            Logger.infoMessage(`Batch saved ${userEventDataArray.length} user events`);
        } catch (err) {
            Logger.errorMessage(`Error in batchSaveUserEvents: ${err.message}`);
            throw err;
        }
    }

    async removeCalendarEvents() {
        if (!this.connection) throw new Error("Database not connected");
        try {
            await this.connection.execute("TRUNCATE TABLE calendar_events");
        } catch (err) {
            Logger.errorMessage(`Error in removeCalendarEvents: ${err.message}`);
            throw err;
        }
    }
}
