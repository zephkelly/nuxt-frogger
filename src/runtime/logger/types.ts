import type { IFroggerReporter } from "./_reporters/types";
import type { FroggerOptions } from "../shared/types/options";
import type { LogType } from "consola";
import type { SpanOptions } from "../shared/utils/span-events";



/**
 * Options for {@link IFroggerLogger.addContext}.
 */
export interface AddContextOptions {
    /**
     * Which side wins when the incoming context shares a key with the existing
     * context.
     *
     * - `true` (default) — the incoming value wins (last-write-wins, the same
     *   convention as pino/winston/bunyan/OpenTelemetry). Re-stamping a key
     *   updates it, so long-lived context like `route` or `user` never freezes
     *   on its first value.
     * - `false` — the existing value is preserved and only keys not already set
     *   are filled in ("set a default if absent").
     *
     * Nested objects are deep-merged either way; this flag only decides the
     * winner on a leaf-key conflict.
     */
    overwrite?: boolean;
}

export interface IFroggerLogger {
    /**
     * Get W3C Trace Context headers for the current logger instance
     * For use with HTTP requests. add to the request headers of $fetch or useFetch:
     * @param customVendor Optional vendor string to use in the headers
     * This will forward the traceID, last spanID, and vendor name of the logger 
     * in the request headers
     *  
     * @example
     * ```ts
     * const logger = useFrogger();
     * logger.info('Making request to API!');
     * 
     * const respose = await $fetch('/api/endpoint', {
     *   method: 'POST',
     *   headers: logger.getHeaders()
     * });
     * 
     * // Then, getFrogger() will automatically parse the headers from the event in your server routes
     * ```
     */
    getHeaders(customVendor?: string): Record<string, string>;

    // Reporter Management ------------------------------------------
    /**
     * Add a custom reporter to the logger
     * @param reporter The reporter object to add
     * This reporter will be used to handle log messages and can be any object that implements the IFroggerReporter interface
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


    // Context Management ------------------------------------------
    /**
     * Merge additional context into the context appended to every log this
     * logger makes. By default the incoming context wins on key conflicts
     * (last-write-wins); pass `{ overwrite: false }` to instead keep existing
     * values and only fill in keys that aren't already set.
     * @param context Additional context to merge into the logger
     * @param options {@link AddContextOptions} controlling merge precedence
     */
    addContext(context: Object, options?: AddContextOptions): void;
    
    /**
     * Set the context for the logger
     * This will replace any existing context with the new context
     * @param context The new context to set for the logger
     */
    setContext(context: Object): void;

    /**
     * Clear all additional context from the logger
     * This will remove all context that has been added to the logger
     */
    clearContext(): void;


    // Child Logger Management ------------------------------------------
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

    /**
     * Run `fn` inside a named span. Every log emitted while `fn` runs —
     * including logs from nested utils that use the ambient `frogger` —
     * automatically nests under this span. The previous active logger is
     * restored when `fn` settles, and nested `span()` calls create deeper
     * levels of the same trace tree.
     * @param name The span name, stored on each log's context as `span`
     * @param fn The function to run inside the span
     * @returns `fn`'s return value
     *
     * @example
     * ```ts
     * await frogger.span('processOrder', async () => {
     *   frogger.info('validating');   // nests under processOrder
     *   await chargeCard();           // its frogger.* logs nest too
     * });
     * ```
     */
    span<T>(name: string, fn: () => T | Promise<T>, options?: SpanOptions): Promise<T>;

    /**
     * Create a named child logger parented under the current span, to hold on
     * to and pass around manually. Unlike `span()` it does not change the
     * ambient active logger — only logs made through the returned instance
     * nest under it.
     * @param name The span name, stored on each log's context as `span`
     * @param options Optional logger options for the child
     */
    startSpan(name: string, options?: FroggerOptions): IFroggerLogger;


        // Log Levels ------------------------------------------
    
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
     * Reset the logger to its initial state
     * This will clear all reporters and context
     */
    reset(): void;
}