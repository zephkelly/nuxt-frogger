import type { IFroggerReporter } from "./_reporters/types";
import type { FroggerOptions } from "../shared/types/options";
import type { LogType } from "consola";



export interface IFroggerLogger {
    // 0 ------------------------------------------
    /**
    * Log an error-level message
    * @param message The primary message to log
    * @param context Additional context to include
    */
    error(message: string, context?: Object): void;

    /**
     * Log a fatal-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    fatal(message: string, context?: Object): void;


    // 1 ------------------------------------------
    /**
     * Log a warning-level message
     * @param message The primary message to log
     * @param context Additional context to include
    */
    warn(message: string, context?: Object): void;


    // 2 ------------------------------------------
    /**
     * Log a fatal-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    log(message: string, context?: Object): void;


    // 3 ------------------------------------------
    /**
     * Log an info-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    info(message: string, context?: Object): void;

    /**
     * Log a success-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    success(message: string, context?: Object): void;

    /**
     * Log a fail-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    fail(message: string, context?: Object): void;

    /**
     * Log a ready-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    ready(message: string, context?: Object): void;

    /**
     * Log a start-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    start(message: string, context?: Object): void;
    

    /**
     * Log a debug-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    debug(message: string, context?: Object): void;

    /**
     * Log a trace-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    trace(message: string, context?: Object): void;

    /**
     * Log a silent-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    silent(message: string, context?: Object): void;

    /**
     * Log a verbose-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    verbose(message: string, context?: Object): void;

    /**
     * Log a message with a specific log level
     * @param level The log level (e.g., 'error', 'warn', 'info', etc.)
     * @param message The primary message to log
     * @param context Additional context to include
     */
    logLevel(level: LogType, message: string, context?: Object): void;


    /**
     * Add a custom reporter to handle log messages
     * @param reporter The reporter object with a log method
     */
    addReporter(reporter: IFroggerReporter): void;

    /**
     * Remove a custom reporter
     * @param reporter The reporter object to remove
     */
    removeReporter(reporter: IFroggerReporter): void;

    /**
     * Get the current list of custom reporters
     * @returns An array of reporter objects
     */
    getReporters(): readonly IFroggerReporter[];

    /**
     * Clear all custom reporters
     */
    clearReporters(): void;



    /**
     * Add additional context to all requests made by the logger
     * @param context Additional context to add to the logger
     */
    addContext(context: Object): void;


    /**
     * Create a non-reactive child logger instance
     * @param options Options for creating a child logger instance
     */
    child(options: FroggerOptions): IFroggerLogger;

    /**
     * Create a reactive child logger instance
     * @param options Options for creating a reactive child logger instance
     */
    reactiveChild(options: FroggerOptions): IFroggerLogger;
}