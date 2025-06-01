import type { IFroggerReporter } from "./frogger-reporter";



export interface IFroggerLogger {
    /**
     * Log a fatal-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    log(message: string, context?: Object): void;

    /**
     * Log an info-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    info(message: string, context?: Object): void;
    
    /**
     * Log a warning-level message
     * @param message The primary message to log
     * @param context Additional context to include
    */
    warn(message: string, context?: Object): void;
   
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
    
    
    /**
     * Log a debug-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    debug(message: string, context?: Object): void;

    /**
     * Log a success-level message
     * @param message The primary message to log
     * @param context Additional context to include
     */
    success(message: string, context?: Object): void;

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
}