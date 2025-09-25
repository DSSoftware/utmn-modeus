const chalk = require('chalk');

/**
 * Enhanced Logger with proper error handling and structured logging
 */
class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    /**
     * Get formatted timestamp
     */
    getTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Check if log level is enabled
     */
    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    /**
     * Format log message with context
     */
    formatMessage(level, message, context = null) {
        const timestamp = this.getTimestamp();
        const contextStr = context ? ` [${context}]` : '';
        return `[${timestamp}]${contextStr} ${message}`;
    }

    /**
     * Log success message
     */
    success(message, context = null) {
        if (!this.shouldLog('info')) return;
        const formatted = this.formatMessage('info', message, context);
        console.log(chalk.bgGreenBright.black` SUCCESS ` + ` ${formatted}`);
    }

    /**
     * Log error message
     */
    error(message, error = null, context = null) {
        if (!this.shouldLog('error')) return;
        const formatted = this.formatMessage('error', message, context);
        console.error(chalk.bgRedBright.black` ERROR ` + ` ${formatted}`);
        
        if (error && typeof error === 'object' && 'stack' in error) {
            console.error(chalk.red(error.stack));
        }
    }

    /**
     * Log info message
     */
    info(message, context = null) {
        if (!this.shouldLog('info')) return;
        const formatted = this.formatMessage('info', message, context);
        console.log(chalk.bgBlueBright.black` INFO ` + ` ${formatted}`);
    }

    /**
     * Log warning message
     */
    warn(message, context = null) {
        if (!this.shouldLog('warn')) return;
        const formatted = this.formatMessage('warn', message, context);
        console.warn(chalk.bgYellowBright.black` WARN ` + ` ${formatted}`);
    }

    /**
     * Log debug message
     */
    debug(message, context = null) {
        if (!this.shouldLog('debug')) return;
        const formatted = this.formatMessage('debug', message, context);
        console.log(chalk.gray` DEBUG ` + ` ${formatted}`);
    }

    // Backward compatibility methods
    successMessage(message) {
        this.success(message);
    }

    errorMessage(message) {
        this.error(message);
    }

    infoMessage(message) {
        this.info(message);
    }

    warnMessage(message) {
        this.warn(message);
    }
}

module.exports = new Logger();