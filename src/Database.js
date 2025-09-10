const mysql = require("mysql2/promise");
const config = require("../config");
const Logger = require("./Logger");

module.exports = class DatabaseHandler {
    connection = null;

    connect() {
        this.connection = mysql.createPool({
            host: config.database.hostname,
            port: config.database.port,
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
        try {
            await this.connection.query(sql);
            return true;
        } catch (err) {
            return false;
        }
    }

    async setup() {
        this.connect();
    }

    async setConfigValue(key, value) {
        try {
            let timestamp = Math.floor(new Date().getTime()/1000);
            await this.connection.execute("INSERT INTO config (`key`, `value`, `timestamp`) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE `value`=?, `timestamp`=?", [key, value, timestamp, value, timestamp]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async getConfigValue(key, expiration=0) {
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
            console.log(err);
            throw err;
        }
    }

    async saveUserModeus(tg_id, modeus_profile) {
        try {
            let timestamp = Math.floor(new Date().getTime()/1000);
            await this.connection.execute("INSERT INTO students (`telegram_id`, `attendee_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `attendee_id`=?", [tg_id, modeus_profile, modeus_profile]);

        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async getGoogleLoginAttempts() {
        try {
            const [results, fields] = await this.connection.execute("SELECT `code`, `tg_id` FROM google_auth GROUP BY `tg_id`", []);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async deleteLoginAttempts(tg_id) {
        try {
            await this.connection.execute("DELETE FROM google_auth WHERE `tg_id`=?", [tg_id]);

        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async saveUserGoogleCalendar(tg_id, google_calendar_token) {
        try {
            let timestamp = Math.floor(new Date().getTime()/1000);
            await this.connection.execute("INSERT INTO students (`telegram_id`, `google_token`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `google_token`=?", [tg_id, google_calendar_token, google_calendar_token]);

        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async saveCalendarID(tg_id, calendar_id) {
        try {
            await this.connection.execute("INSERT INTO students (`telegram_id`, `calendar_id`) VALUES(?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?", [tg_id, calendar_id, calendar_id]);

        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async getUserInfo(tg_id) {
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM students WHERE `telegram_id`=?", [tg_id]);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async *getRecheckUsers() {
        const sql = "SELECT * FROM students WHERE `attendee_id` IS NOT NULL AND `google_token` IS NOT NULL";
        let conn;

        try {
            conn = await this.connection.getConnection();
            const stream = conn.connection.query(sql).stream();

            for await (const row of stream) {
                yield row;
            }
        } catch (err) {
            Logger.errorMessage('Error during streaming');
            console.log(err);
            throw err; 
        } finally {
            if (conn) {
                conn.release();
            }
        }
    }
    
    async *getLoggedAttendees() {
        const sql = "SELECT `attendee_id` FROM student_events GROUP BY `attendee_id`";
        let conn;

        try {
            conn = await this.connection.getConnection();
            const stream = conn.connection.query(sql).stream();

            for await (const row of stream) {
                yield row;
            }
        } catch (err) {
            Logger.errorMessage('Error during streaming');
            console.log(err);
            throw err; 
        } finally {
            if (conn) {
                conn.release();
            }
        }
    }

    async findAttendee(attendee_id) {
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM students WHERE `attendee_id`=?", [attendee_id]);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async getUserEvents(attendee_id) {
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM student_events WHERE `attendee_id`=?", [attendee_id]);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async getEvent(event_id) {
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM events WHERE `event_id`=?", [event_id]);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async saveEvent(event_id, recheck, timestamp, data) {
        try {
            await this.connection.execute("INSERT INTO events (`event_id`, `last_update`, `timestamp`, `event_data`) VALUES(?, ?, ?, ?) ON DUPLICATE KEY UPDATE `last_update`=?, `timestamp`=?, `event_data`=?", [event_id, recheck, timestamp, data, recheck, timestamp, data]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async saveUserEvent(event, attendee, event_id, recheck, timestamp) {
        try {
            await this.connection.execute("INSERT INTO student_events (`event`, `attendee_id`, `event_id`, `last_update`, `timestamp`) VALUES(?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `attendee_id`=?, `event_id`=?, `last_update`=?, `timestamp`=?", [event, attendee, event_id, recheck, timestamp, attendee, event_id, recheck, timestamp]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async saveCalendarEvent(modeus_id, calendar_id, timestamp) {
        try {
            await this.connection.execute("INSERT INTO calendar_events (`modeus_id`, `calendar_id`, `timestamp`) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE `calendar_id`=?, `timestamp`=?", [modeus_id, calendar_id, timestamp, calendar_id, timestamp]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async findCalendarEvent(modeus_id) {
        try {
            const [results, fields] = await this.connection.execute("SELECT * FROM `calendar_events` WHERE `modeus_id`=?", [modeus_id]);

            return results;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async deleteCalendarEvent(modeus_id) {
        try {
            await this.connection.execute("DELETE FROM calendar_events WHERE `modeus_id`=?", [modeus_id]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async removeCalendarEvents() {
        try {
            await this.connection.execute("DELETE FROM calendar_events WHERE 1");
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async cleanupOldEvents(timestamp, refresh_ts) {
        try {
            await this.connection.execute("DELETE FROM events WHERE `timestamp`<? OR `last_update`!=?", [timestamp, refresh_ts]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async cleanupOldStudentEvents(timestamp, refresh_ts) {
        try {
            await this.connection.execute("DELETE FROM student_events WHERE `timestamp`<? OR `last_update`!=?", [timestamp, refresh_ts]);
        } catch (err) {
            console.log(err);
            throw err;
        }
    }
};
