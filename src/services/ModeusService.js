const Logger = require("../Logger");
const { findModeusEvents } = require("../api/modeus");
const { getDates } = require("../utils/date");

async function recheckModeus(db) {
    Logger.infoMessage("Rechecking Modeus Events...");
    let attendees_for_modeus_fetch = [];
    let recheck_started_modeus = Math.floor(new Date().getTime() / 1000);

    let students_stat = 0;
    let events_stat = 0;

    async function fetchAssociatedEvents(attendee_list) {
        let events = await findModeusEvents(attendee_list, db);
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

    const students = db.getRecheckUsers();
    const studentChunks = [];
    let currentChunk = [];

    for await (const student_user of students) {
        currentChunk.push(student_user.attendee_id);
        students_stat++;
        if (currentChunk.length >= 10) {
            studentChunks.push(currentChunk);
            currentChunk = [];
        }
    }
    if (currentChunk.length > 0) {
        studentChunks.push(currentChunk);
    }

    await Promise.all(studentChunks.map(chunk => fetchAssociatedEvents(chunk)));


    Logger.successMessage("Rechecked Modeus Events.");
    await db.setConfigValue("lastRefresh", recheck_started_modeus);
    console.log(`Modeus Recheck Stats:\nStudents: ${students_stat}\nEvents: ${events_stat}`);
    console.log(`Modeus Recheck Time: ${Math.floor(new Date().getTime() / 1000) - recheck_started_modeus} seconds`);
    let monday_timestamp = Math.floor(getDates().start_timestamp / 1000);
    await db.cleanupOldEvents(monday_timestamp, recheck_started_modeus);
    await db.cleanupOldStudentEvents(monday_timestamp, recheck_started_modeus);
}

module.exports = {
    recheckModeus,
};
