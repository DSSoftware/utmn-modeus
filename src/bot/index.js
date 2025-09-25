const tg = require("telegraf");
const config = require("../../config");
const Logger = require("../Logger");
const { recheckModeus } = require("../services/ModeusService");
const { resetCalendars } = require("../services/googleSyncService");
const { findModeusUser } = require("../api/modeus");
const { google } = require("googleapis");
const crypto = require("crypto");
const { day, month, year, hour, minute } = require("../utils/date");

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
                let logged_google_users = await db.getLoggedAttendees();
                const calendarOAuthInstance = new google.auth.OAuth2(
                    config.google.client_id,
                    config.google.secret_id,
                    config.google.redirect
                );
                for await (const gcal_user of logged_google_users) {
                    let user_modeus_id = gcal_user.attendee_id;
                    let user_details_array = await db.findAttendee(user_modeus_id);
                    let user_details = user_details_array[0];
                    if (!user_details.google_token) {
                        Logger.infoMessage(
                            `Admin: User ${user_modeus_id} has no Google Token, skipping calendar deletion.`
                        );
                        continue;
                    }
                    calendarOAuthInstance.setCredentials({ refresh_token: user_details.google_token });
                    const calendar_single_op = google.calendar({ version: "v3", auth: calendarOAuthInstance });
                    let app_calendar_id = user_details.calendar_id;

                    await calendar_single_op.calendars.delete({ calendarId: app_calendar_id }).catch((e) => {
                        console.log(e);
                    });
                    await db.saveCalendarID(user_details.telegram_id, null);
                }

                await db.removeCalendarEvents();
            } catch (e) {
                console.log(e);
            }
            ctx.reply("Done - Deleted Calendars");
        }
        if (ctx.message.text == "redo_checks") {
            try {
                await recheckModeus(db);
            } catch (e) {
                console.log(e);
            }
            ctx.reply("Done - Rechecked Modeus Events");
        }
    });

    bot.action(/reset_listeners/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        user_states.set(ctx.from.id, "none");
        ctx.deleteMessage(ctx.callbackQuery?.message?.message_id).catch(() => { });
    });

    registerInfoCommands();
    registerModeusSync();
    registerGoogleSync();
    registerUtilityCommands();

    function registerInfoCommands() {
        async function sendHelpDialog(ctx) {
            ctx.reply(
                `Этот бот может привязать твой аккаунт Modeus (ТюмГУ) к календарю Google.\n📅 Расписание будет автоматически появляться и обновляться в календаре.\n\n<b><u>🔗 Как подключить?</u></b>\n🎓 1. Используй команду /link_modeus чтобы выбрать твой аккаунт Modeus.\n📅 2. Используй команду /link_google чтобы подключить бота к календарю.\n⌛ 3. Расписание подгрузится автоматически в течение 15 минут.\n\nТы можешь проверить время последнего обновления при помощи команды /info`,
                {
                    parse_mode: "HTML",
                }
            ).catch((e) => Logger.errorMessage(`Error sending help dialog: ${e.message}`));
        }

        bot.command("info", (ctx) => {
            (async () => {
                ctx.deleteMessage(ctx.message.message_id).catch(() => { });

                let user_info = await db.getUserInfo(ctx.from.id);

                let linked_modeus = false;
                let linked_google = false;

                if (user_info.length != 0) {
                    if (user_info[0].attendee_id != null) {
                        linked_modeus = true;
                    }
                    if (user_info[0].google_token != null) {
                        linked_google = true;
                    }
                }

                let can_refresh = linked_google && linked_modeus;

                let last_refresh = await db.getConfigValue("lastRefresh");
                let relative_refresh = "никогда";
                if (last_refresh.length == 1) {
                    let rd = new Date(last_refresh[0].value * 1000 + 5 * 60 * 60 * 1000);

                    relative_refresh = `${day(rd)}.${month(rd)}.${year(rd)} ${hour(rd)}:${minute(rd)}`;
                }

                ctx.reply(
                    `<b><u>👤 Информация</u></b>\n\n<u>🔗 Профили</u>\nПрофиль Modeus: <b>${linked_modeus ? "✅ Привязан" : "❌ Не привязан"
                    }</b>\nПрофиль Google: <b>${linked_google ? "✅ Привязан" : "❌ Не привязан"}</b>\n\nНастройка: <b>${can_refresh ? "✅ Готово к работе" : "❌ Один из профилей не привязан"
                    }</b>\n\n<u>🔁 Последнее обновление</u>\nСписок событий Modeus обновлён <u>${relative_refresh}</u> (UTC+5)`,
                    {
                        parse_mode: "HTML",
                    }
                ).catch((e) => Logger.errorMessage(`Error sending info reply: ${e.message}`));
            })();
        });

        bot.start((ctx) => {
            ctx.deleteMessage(ctx.message.message_id).catch(() => { });
            sendHelpDialog(ctx);
        });

        bot.help((ctx) => {
            ctx.deleteMessage(ctx.message.message_id).catch(() => { });
            sendHelpDialog(ctx);
        });
    }

    function registerModeusSync() {
        bot.command("link_modeus", (ctx) => {
            ctx.deleteMessage(ctx.message.message_id).catch(() => { });
            ctx.reply(
                `<b><u>🎓 Подключение Modeus</u></b>\n\nВведи полное ФИО в таком порядке:\n<code>Иванов Иван Иванович</code>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]],
                    },
                }
            ).catch((e) => Logger.errorMessage(`Error sending link_modeus prompt: ${e.message}`));
            user_states.set(ctx.from.id, "modeus_listener");
        });

        textHandlers.push(async (ctx) => {
            if (user_states.get(ctx.from.id) != "modeus_listener") {
                return;
            }
            try {
                let user_name = ctx.message.text;
                let search_results = await findModeusUser(user_name);

                let buttons = [];

                for (const student of search_results) {
                    if (buttons.length >= 5) {
                        break;
                    }
                    buttons.push([{ text: `${student.name}${student.student}`, callback_data: `modeus_${student.id}` }]);
                }

                if (buttons.length === 0) {
                    await ctx
                        .reply(
                            `<b><u>🎓 Профили не найдены</u></b>\n\nПо твоему запросу "${user_name}" профили не найдены. Попробуй еще раз или напиши @artem2584.`,
                            {
                                parse_mode: "HTML",
                                reply_markup: {
                                    inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]],
                                },
                            }
                        )
                        .catch((e) => Logger.errorMessage(`Error replying no profiles found: ${e.message}`));
                } else {
                    await ctx
                        .reply(
                            `<b><u>🎓 Выбери свой профиль</u></b>\n\nНайдено профилей: <b>${search_results.length}</b>.\nЕсли нет твоего профиля, попробуй уточнить ФИО или напиши @artem2584.`,
                            {
                                parse_mode: "HTML",
                                reply_markup: {
                                    inline_keyboard: [
                                        ...buttons,
                                        [{ text: "❌ Отмена", callback_data: "reset_listeners" }],
                                    ],
                                },
                            }
                        )
                        .catch((e) => Logger.errorMessage(`Error replying with profiles: ${e.message}`));
                }
            } catch (e) {
                Logger.errorMessage(`Error in modeus_listener textHandler: ${e.message} ${e.stack}`);
                await ctx
                    .reply("Произошла ошибка при поиске. Попробуй позже.")
                    .catch((e) => Logger.errorMessage(`Error replying search error: ${e.message}`));
            }
        });

        bot.action(/modeus_(.+)/, async (ctx) => {
            const profile_id = ctx.match[1];
            await ctx.answerCbQuery().catch(() => { });
            user_states.set(ctx.from.id, "none");

            await db.saveUserModeus(ctx.from.id, profile_id);

            await ctx
                .editMessageText(
                    `<b><u>🎓 Профиль Modeus привязан!</u></b>\n\nТы успешно привязал свой профиль.\nID твоего профиля: <code>${profile_id}</code>`,
                    { parse_mode: "HTML" }
                )
                .catch((e) => Logger.errorMessage(`Error editing modeus linked message: ${e.message}`));
        });
    }

    function registerGoogleSync() {
        bot.command("link_google", (ctx) => {
            ctx.deleteMessage(ctx.message.message_id).catch(() => { });

            let issue_time = Math.floor(new Date().getTime() / 1000);
            let state = `${ctx.from.id}-${issue_time}-${crypto.createHash("sha256").update(`${ctx.from.id}-${issue_time}-${config.credentials.internal}`).digest('hex')}`;

            const url = googleOAuth.generateAuthUrl({
                access_type: "offline",
                scope: ["https://www.googleapis.com/auth/calendar.app.created"],
                state: state,
                prompt: "consent",
            });

            ctx.reply(
                `<b><u>📅 Подключение Google Calendar</u></b>\n\n❗ Бот создаст новый календарь "Modeus Integration" в твоём Google Аккаунте и будет управлять только им.\nТвои существующие календари и события затронуты не будут.\n\n<a href="${url}">➡️ Перейди по этой ссылке, чтобы разрешить доступ.</a>\n\nЕсли не получается привязать аккаунт, напиши @artem2584`,
                { parse_mode: "HTML" }
            ).catch((e) => Logger.errorMessage(`Error sending link_google prompt: ${e.message}`));
        });

        setInterval(async () => {
            let login_attempts = await db.getGoogleLoginAttempts();
            if (login_attempts.length === 0) return;

            Logger.infoMessage(`Processing ${login_attempts.length} Google login attempts.`);
            for (const login_attempt of login_attempts) {
                let tg_id = login_attempt.tg_id;
                let code = login_attempt.code;

                let attempt_googleOAuth = new google.auth.OAuth2(
                    config.google.client_id,
                    config.google.secret_id,
                    config.google.redirect
                );

                try {
                    const { tokens } = await attempt_googleOAuth.getToken(code);
                    await db.deleteLoginAttempts(tg_id);

                    if (!tokens || !tokens.refresh_token) {
                        Logger.errorMessage(
                            `Failed to get refresh_token for tg_id ${tg_id}. Tokens: ${JSON.stringify(tokens)}`
                        );
                        await bot.telegram
                            .sendMessage(
                                tg_id,
                                `❌ Не удалось привязать Google! Попробуй привязать ещё раз через /link_google.\nЕсли проблема повторяется, напиши @artem2584.`
                            )
                            .catch((e) => Logger.errorMessage(`Error sending TG message (no refresh token): ${e.message}`));
                        continue;
                    }
                    await db.saveUserGoogleCalendar(tg_id, tokens.refresh_token);
                    Logger.infoMessage(`Successfully obtained and saved refresh_token for tg_id ${tg_id}.`);
                    await bot.telegram
                        .sendMessage(
                            tg_id,
                            `✅ Google Calendar был успешно привязан! Расписание начнет синхронизироваться в течение 15-30 минут.`
                        )
                        .catch((e) => Logger.errorMessage(`Error sending TGMessage (success link): ${e.message}`));
                } catch (err) {
                    Logger.errorMessage(
                        `Error exchanging Google token for tg_id ${tg_id}: ${err.message}. Code used: ${code ? code.substring(0, 20) + "..." : "N/A"
                        }`
                    );
                    await db.deleteLoginAttempts(tg_id);
                    let userMessage = `❌ Ошибка при привязке Google Calendar: ${err.message}.\nПопробуй еще раз через /link_google.`;
                    if (
                        err.message &&
                        (err.message.includes("invalid_grant") || err.message.includes("code has already been used"))
                    ) {
                        userMessage = `❌ Ошибка: код авторизации уже использован или недействителен. Пожалуйста, сгенерируй новую ссылку через /link_google и используй ее сразу.`;
                    }
                    await bot.telegram
                        .sendMessage(tg_id, userMessage + `\nЕсли не получится, напиши @artem2584.`)
                        .catch((e) => Logger.errorMessage(`Error sending TG message (token exchange error): ${e.message}`));
                }
            }
        }, 15 * 1000);
    }

    function registerUtilityCommands() {
        bot.command("reset_calendar", (ctx) => {
            (async () => {
                ctx.deleteMessage(ctx.message.message_id).catch(() => { });

                db.saveCalendarID(ctx.from.id, null);
                ctx.reply("✅ Успех! Был создан новый календарь. Теперь твои события будут отображаться в нём.");
            })();
        });
    }

    bot.catch((err, ctx) => {
        Logger.errorMessage(`Bot error for user ${ctx.from?.id}: ${err.message}`);
        console.error('Bot error:', err);
    });

    bot.launch().then(() => {
        Logger.successMessage("Bot has been launched successfully.");
    }).catch((err) => {
        Logger.errorMessage(`Failed to launch bot: ${err.message}`);
        throw err;
    });

    return bot;
}

module.exports = {
    setupBot
}