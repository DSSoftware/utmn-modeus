const { Telegraf } = require("telegraf");
const logger = require("../utils/Logger");
const config = require("../utils/ConfigManager");

/**
 * Telegram Bot Service with clean handler management
 */
class TelegramBotService {
    constructor(database, modeusService, googleService) {
        this.database = database;
        this.modeusService = modeusService;
        this.googleService = googleService;
        this.bot = new Telegraf(config.get('credentials.telegram'));
        this.appConfig = config.get('app');
        
        // User state management
        this.userStates = new Map();
        this.textHandlers = [];

        this.setupBot();
    }

    /**
     * Setup bot handlers and middleware
     */
    setupBot() {
        // Setup command handlers
        this.setupCommandHandlers();
        
        // Setup text handlers
        this.setupTextHandlers();
        
        // Setup action handlers
        this.setupActionHandlers();
        
        // Setup error handling
        this.bot.catch((error) => {
            logger.error("Bot error", error);
        });

        logger.success("Telegram bot handlers configured");
    }

    /**
     * Setup command handlers
     */
    setupCommandHandlers() {
        // Start command
        this.bot.start((ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            this.sendHelpDialog(ctx);
        });

        // Help command
        this.bot.help((ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            this.sendHelpDialog(ctx);
        });

        // Info command
        this.bot.command("info", async (ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            await this.handleInfoCommand(ctx);
        });

        // Link Modeus command
        this.bot.command("link_modeus", (ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            this.handleLinkModeusCommand(ctx);
        });

        // Link Google command
        this.bot.command("link_google", (ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            this.handleLinkGoogleCommand(ctx);
        });

        // Reset calendar command
        this.bot.command("reset_calendar", async (ctx) => {
            this.deleteMessage(ctx, ctx.message.message_id);
            await this.handleResetCalendarCommand(ctx);
        });

        logger.info("Command handlers registered");
    }

    /**
     * Setup text handlers
     */
    setupTextHandlers() {
        // Main text handler
        this.bot.hears(/^(?!\/).*$/, (ctx) => {
            if (ctx.message.text.startsWith("/")) {
                return;
            }
            
            for (const handler of this.textHandlers) {
                try {
                    handler(ctx);
                } catch (error) {
                    logger.error("Error in text handler", error);
                }
            }
        });

        // Admin text handlers
        this.textHandlers.push(async (ctx) => {
            if (ctx.from.id != this.appConfig.admin_id) return;
            
            await this.handleAdminCommands(ctx);
        });

        // Modeus search handler
        this.textHandlers.push(async (ctx) => {
            if (this.userStates.get(ctx.from.id) !== "modeus_listener") return;
            
            await this.handleModeusSearch(ctx);
        });

        logger.info("Text handlers registered");
    }

    /**
     * Setup action (callback) handlers
     */
    setupActionHandlers() {
        // Reset listeners action
        this.bot.action(/reset_listeners/, async (ctx) => {
            await ctx.answerCbQuery().catch(() => {});
            this.userStates.set(ctx.from.id, "none");
            this.deleteMessage(ctx, ctx.callbackQuery?.message?.message_id);
        });

        // Modeus selection action
        this.bot.action(/modeus_(.+)/, async (ctx) => {
            await this.handleModeusSelection(ctx);
        });

        logger.info("Action handlers registered");
    }

    /**
     * Send help dialog
     */
    async sendHelpDialog(ctx) {
        const helpMessage = `Этот бот может привязать твой аккаунт Modeus (ТюмГУ) к календарю Google.
📅 Расписание будет автоматически появляться и обновляться в календаре.

<b><u>🔗 Как подключить?</u></b>
🎓 1. Используй команду /link_modeus чтобы выбрать твой аккаунт Modeus.
📅 2. Используй команду /link_google чтобы подключить бота к календарю.
⌛ 3. Расписание подгрузится автоматически в течение 15 минут.

Ты можешь проверить время последнего обновления при помощи команды /info`;

        try {
            await ctx.reply(helpMessage, { parse_mode: "HTML" });
        } catch (error) {
            logger.error("Error sending help dialog", error);
        }
    }

    /**
     * Handle info command
     */
    async handleInfoCommand(ctx) {
        try {
            const userInfo = await this.database.getUserInfo(ctx.from.id);
            
            let linkedModeus = false;
            let linkedGoogle = false;

            if (userInfo.length > 0) {
                linkedModeus = userInfo[0].attendee_id != null;
                linkedGoogle = userInfo[0].google_token != null;
            }

            const canRefresh = linkedGoogle && linkedModeus;
            const lastRefresh = await this.getLastRefreshTime();

            const infoMessage = `<b><u>👤 Информация</u></b>

<u>🔗 Профили</u>
Профиль Modeus: <b>${linkedModeus ? "✅ Привязан" : "❌ Не привязан"}</b>
Профиль Google: <b>${linkedGoogle ? "✅ Привязан" : "❌ Не привязан"}</b>

Настройка: <b>${canRefresh ? "✅ Готово к работе" : "❌ Один из профилей не привязан"}</b>

<u>🔁 Последнее обновление</u>
Список событий Modeus обновлён <u>${lastRefresh}</u> (UTC+5)`;

            await ctx.reply(infoMessage, { parse_mode: "HTML" });

        } catch (error) {
            logger.error("Error handling info command", error);
            await ctx.reply("Произошла ошибка при получении информации. Попробуй позже.");
        }
    }

    /**
     * Handle link Modeus command
     */
    handleLinkModeusCommand(ctx) {
        const message = `<b><u>🎓 Подключение Modeus</u></b>

Введи полное ФИО в таком порядке:
<code>Иванов Иван Иванович</code>`;

        const keyboard = {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]]
        };

        ctx.reply(message, {
            parse_mode: "HTML",
            reply_markup: keyboard
        }).catch(error => logger.error("Error sending link_modeus prompt", error));

        this.userStates.set(ctx.from.id, "modeus_listener");
    }

    /**
     * Handle link Google command
     */
    handleLinkGoogleCommand(ctx) {
        try {
            const url = this.googleService.generateAuthUrl(ctx.from.id);
            
            const message = `<b><u>📅 Подключение Google Calendar</u></b>

❗ Бот создаст новый календарь "Modeus Integration" в твоём Google Аккаунте и будет управлять только им.
Твои существующие календари и события затронуты не будут.

<a href="${url}">➡️ Перейди по этой ссылке, чтобы разрешить доступ.</a>

Если не получается привязать аккаунт, напиши @artem2584`;

            ctx.reply(message, { parse_mode: "HTML" }).catch(error =>
                logger.error("Error sending link_google prompt", error)
            );

        } catch (error) {
            logger.error("Error handling link_google command", error);
            ctx.reply("Произошла ошибка при генерации ссылки. Попробуй позже.");
        }
    }

    /**
     * Handle reset calendar command
     */
    async handleResetCalendarCommand(ctx) {
        try {
            await this.database.saveCalendarID(ctx.from.id, null);
            await ctx.reply("✅ Успех! Был создан новый календарь. Теперь твои события будут отображаться в нём.");
        } catch (error) {
            logger.error("Error resetting calendar", error);
            await ctx.reply("Произошла ошибка при сбросе календаря. Попробуй позже.");
        }
    }

    /**
     * Handle admin commands
     */
    async handleAdminCommands(ctx) {
        const text = ctx.message.text;

        if (text === "reset_calendars") {
            try {
                await this.googleService.resetAllCalendars();
                await ctx.reply("Done - Deleted Calendars");
            } catch (error) {
                logger.error("Error resetting calendars", error);
                await ctx.reply("Error resetting calendars");
            }
        }

        if (text === "redo_checks") {
            try {
                // This would trigger a manual sync - implemented in SyncService
                await ctx.reply("Manual sync triggered");
            } catch (error) {
                logger.error("Error triggering manual sync", error);
                await ctx.reply("Error triggering sync");
            }
        }
    }

    /**
     * Handle Modeus user search
     */
    async handleModeusSearch(ctx) {
        try {
            const userName = ctx.message.text;
            const searchResults = await this.modeusService.findUser(userName);

            if (searchResults.length === 0) {
                const message = `<b><u>🎓 Профили не найдены</u></b>

По твоему запросу "${userName}" профили не найдены. Попробуй еще раз или напиши @artem2584.`;

                await ctx.reply(message, {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "❌ Отмена", callback_data: "reset_listeners" }]]
                    }
                });
                return;
            }

            const buttons = [];
            for (let i = 0; i < Math.min(searchResults.length, 5); i++) {
                const student = searchResults[i];
                buttons.push([{
                    text: `${student.name}${student.student}`,
                    callback_data: `modeus_${student.id}`
                }]);
            }

            buttons.push([{ text: "❌ Отмена", callback_data: "reset_listeners" }]);

            const message = `<b><u>🎓 Выбери свой профиль</u></b>

Найдено профилей: <b>${searchResults.length}</b>.
Если нет твоего профиля, попробуй уточнить ФИО или напиши @artem2584.`;

            await ctx.reply(message, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });

        } catch (error) {
            logger.error("Error in Modeus search", error);
            await ctx.reply("Произошла ошибка при поиске. Попробуй позже.");
        }
    }

    /**
     * Handle Modeus profile selection
     */
    async handleModeusSelection(ctx) {
        try {
            const profileId = ctx.match[1];
            await ctx.answerCbQuery();
            
            this.userStates.set(ctx.from.id, "none");
            
            await this.database.saveUserModeus(ctx.from.id, profileId);
            
            const message = `<b><u>🎓 Профиль Modeus привязан!</u></b>

Ты успешно привязал свой профиль.
ID твоего профиля: <code>${profileId}</code>`;

            await ctx.editMessageText(message, { parse_mode: "HTML" });

        } catch (error) {
            logger.error("Error handling Modeus selection", error);
            await ctx.answerCbQuery("Произошла ошибка. Попробуй позже.");
        }
    }

    /**
     * Get last refresh time formatted
     */
    async getLastRefreshTime() {
        try {
            const lastRefresh = await this.database.getConfigValue("lastRefresh");
            if (lastRefresh.length === 0) {
                return "никогда";
            }

            const date = new Date(lastRefresh[0].value * 1000);
            return date.toLocaleString('ru-RU', {
                timeZone: 'Asia/Yekaterinburg',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

        } catch (error) {
            logger.error("Error getting last refresh time", error);
            return "ошибка";
        }
    }

    /**
     * Utility function to safely delete messages
     */
    deleteMessage(ctx, messageId) {
        if (messageId) {
            ctx.deleteMessage(messageId).catch(() => {
                // Ignore errors - message might already be deleted
            });
        }
    }

    /**
     * Send message to user (used by other services)
     */
    async sendMessage(telegramId, message) {
        try {
            await this.bot.telegram.sendMessage(telegramId, message);
            return true;
        } catch (error) {
            logger.error(`Failed to send message to user ${telegramId}`, error);
            return false;
        }
    }

    /**
     * Start the bot
     */
    async start() {
        try {
            this.bot.launch().catch(e => 
                logger.error("Failed to start Telegram bot", e)
            );
            logger.success("Telegram bot started successfully");

            // Graceful stop handlers
            process.once("SIGINT", () => this.stop("SIGINT"));
            process.once("SIGTERM", () => this.stop("SIGTERM"));

        } catch (error) {
            logger.error("Failed to start Telegram bot", error);
            throw error;
        }
    }

    /**
     * Stop the bot gracefully
     */
    stop(signal) {
        logger.info(`${signal} received, stopping bot...`);
        this.bot.stop(signal);
    }
}

module.exports = TelegramBotService;