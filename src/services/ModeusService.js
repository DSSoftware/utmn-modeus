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

        if (events.length === 0) return;

        // Batch prepare all event data
        const eventBatchData = [];
        const userEventBatchData = [];

        // Этап 1: Подготавливаем все события для батчевой вставки
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
            
            eventBatchData.push([event.info.id, recheck_started_modeus, timestamp, JSON.stringify(event_object)]);
        }

        // Этап 2: Подготавливаем все связи пользователь-событие для батчевой вставки
        for (const event of events) {
            let timestamp = new Date(event.info.startsAt).getTime() / 1000;
            for (const attendee_id of attendee_list) {
                if (!event.attendee_list.includes(attendee_id)) continue;
                
                const eventKey = `${attendee_id};${event.info.id}`;
                userEventBatchData.push([eventKey, attendee_id, event.info.id, recheck_started_modeus, timestamp]);
            }
        }

        // Выполняем батчевые операции вместо individual queries
        await db.batchSaveEvents(eventBatchData);
        await db.batchSaveUserEvents(userEventBatchData);
    }

    const students = db.getRecheckUsers();
    const studentChunks = [];
    let currentChunk = [];

    for await (const student_user of students) {
        currentChunk.push(student_user.attendee_id);
        students_stat++;
        // Увеличиваем размер чанка с 15 до 50 для лучшей производительности
        if (currentChunk.length >= 15) {
            studentChunks.push(currentChunk);
            currentChunk = [];
        }
    }
    if (currentChunk.length > 0) {
        studentChunks.push(currentChunk);
    }

    Logger.infoMessage(`Processing ${students_stat} students in ${studentChunks.length} chunks`);

    // Обрабатываем чанки с таймером для лучшего мониторинга
    let chunkIndex = 0;
    for (const chunk of studentChunks) {
        const chunkStart = Date.now();
        await fetchAssociatedEvents(chunk);
        const chunkTime = (Date.now() - chunkStart) / 1000;
        chunkIndex++;
        Logger.infoMessage(`Processed chunk ${chunkIndex}/${studentChunks.length} (${chunk.length} students) in ${chunkTime.toFixed(2)}s`);
    }


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
