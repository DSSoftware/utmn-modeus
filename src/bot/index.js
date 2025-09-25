const tg = require("telegraf");
const config = require("../config");
const Logger = require("../Logger");
const { recheckModeus } = require("../services/ModeusService");
const { resetCalendars } = require("../services/googleSyncService");
const { findModeusUser } = require("../api/modeus");
const { google } = require("googleapis");

function setupBot(db) {
    if (!config.credentials.telegram) {
        throw new Error("TELEGRAM_TOKEN is not defined in the environment variables.");
    }
    const bot = new tg.Telegraf(config.credentials.telegram);
    const googleOAuth = new google.auth.OAuth2(config.google.client_id, config.google.secret_id, config.google.redirect);

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

    textHandlers.push(async (ctx) => {
        if (ctx.from.id != config.admin) return;
        if (ctx.message.text == "reset_calendars") {
            try {
                await resetCalendars(db);
                ctx.reply("Done - Deleted Calendars");
            } catch (e) {
                Logger.errorMessage(`Admin command 'reset_calendars' failed: ${e.message}`);
                ctx.reply("Error during calendar reset.");
            }
        }
        if (ctx.message.text == "redo_checks") {
            try {
                await recheckModeus(db);
                ctx.reply("Done - Rechecked Modeus Events");
            } catch (e) {
                Logger.errorMessage(`Admin command 'redo_checks' failed: ${e.message}`);
                ctx.reply("Error during Modeus recheck.");
            }
        }
    });

    bot.command("start", async (ctx) => {
        let user_info = await db.getUserInfo(ctx.from.id);
        if (user_info.length == 0) {
            await db.createUser(ctx.from.id); // Ensure user exists
            ctx.reply(
                "Привет! Я бот для интеграции расписания Modeus с Google Calendar. Для начала мне нужен твой профиль в Modeus. Введи своё ФИО, чтобы я мог тебя найти."
            );
            user_states.set(ctx.from.id, "awaiting_name");
        } else {
            user_info = user_info[0];
            if (user_info.attendee_id == null) {
                ctx.reply("Кажется, у тебя не настроен профиль Modeus. Введи своё ФИО, чтобы я мог тебя найти.");
                user_states.set(ctx.from.id, "awaiting_name");
            } else if (user_info.google_token == null) {
                const authUrl = googleOAuth.generateAuthUrl({
                    access_type: "offline",
                    scope: ["https://www.googleapis.com/auth/calendar"],
                    state: `tg_id=${ctx.from.id}`,
                });
                ctx.reply(
                    `Твой профиль Modeus уже настроен. Теперь нужно предоставить доступ к Google Calendar. Перейди по ссылке и предоставь доступ: ${authUrl}`
                );
            } else {
                ctx.reply("Всё уже настроено! Расписание будет синхронизироваться автоматически.");
            }
        }
    });

    textHandlers.push(async (ctx) => {
        if (user_states.get(ctx.from.id) == "awaiting_name") {
            let name = ctx.message.text;
            let users = await findModeusUser(name);
            if (users.length == 0) {
                ctx.reply("Не удалось найти пользователей с таким ФИО. Попробуй ещё раз.");
                return;
            }

            let buttons = [];
            for (const user of users) {
                buttons.push(tg.Markup.button.callback(`${user.name}${user.student}`, `select_user_${user.id}`));
            }

            ctx.reply("Найденные пользователи:", tg.Markup.inlineKeyboard(buttons, { columns: 1 }));
            user_states.delete(ctx.from.id);
        }
    });

    bot.action(/select_user_(.*)/, async (ctx) => {
        let user_id = ctx.match[1];
        await db.saveUserModeus(ctx.from.id, user_id);
        ctx.answerCbQuery("Профиль Modeus сохранён!");

        const authUrl = googleOAuth.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/calendar"],
            state: `tg_id=${ctx.from.id}`,
        });
        ctx.reply(
            `Отлично! Теперь нужно предоставить доступ к Google Calendar. Перейди по ссылке и предоставь доступ: ${authUrl}`
        );
    });

    async function handleGoogleAuth() {
        let attempts = await db.getGoogleLoginAttempts();
        for (const attempt of attempts) {
            try {
                const { tokens } = await googleOAuth.getToken(attempt.code);
                if (tokens.refresh_token) {
                    await db.saveUserGoogleCalendar(attempt.tg_id, tokens.refresh_token);
                    bot.telegram.sendMessage(attempt.tg_id, "Доступ к Google Calendar получен! Синхронизация скоро начнётся.");
                } else {
                    bot.telegram.sendMessage(
                        attempt.tg_id,
                        "Не удалось получить токен обновления. Попробуй ещё раз. Убедись, что ты даёшь доступ в оффлайн-режиме."
                    );
                }
            } catch (e) {
                bot.telegram.sendMessage(attempt.tg_id, "Произошла ошибка при авторизации в Google. Попробуй ещё раз.");
                Logger.errorMessage(`Google Auth error for tg_id ${attempt.tg_id}: ${e.message}`);
            } finally {
                await db.deleteLoginAttempts(attempt.tg_id);
            }
        }
    }

    setInterval(handleGoogleAuth, 5000);

    bot.launch();
    Logger.successMessage("Bot has been launched.");
    return bot;
}

module.exports = {
    setupBot
}