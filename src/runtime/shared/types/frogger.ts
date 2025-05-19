import type { LogContext } from '../types';



export interface FroggerLogger {
    /**
     * Log a fatal-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
     */
    log(message: any, ...args: any[]): void;

    /**
     * Log an info-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
     */
    info(message: any, ...args: any[]): void;
    
    /**
     * Log a warning-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
    */
    warn(message: any, ...args: any[]): void;
   
    /**
    * Log an error-level message
    * @param message The primary message to log
    * @param args Additional arguments to include
    */
    error(message: any, ...args: any[]): void;

    /**
     * Log a fatal-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
     */
    fatal(message: any, ...args: any[]): void;
    
    
    /**
     * Log a debug-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
     */
    debug(message: any, ...args: any[]): void;
    
    /**
     * Log a trace-level message
     * @param message The primary message to log
     * @param args Additional arguments to include
     */
    trace(message: any, ...args: any[]): void;


    /**
     * Add context data to be included with all logs
     * @param context The context data to add
     */
    addGlobalContext(context: LogContext): void;
    
    /**
     * Set the user ID for the current logger context
     * @param userId The user identifier
     */
    setUser(userId: string): void;
    
    /**
     * Set the session ID for the current logger context
     * @param sessionId The session identifier
     */
    setSession(sessionId: string): void;
    
    /**
     * Start a new span for tracing operations
     * @param name The name of the operation
     * @param attributes Additional attributes for the span
     * @returns An object with methods to end the span and access its context
     */
    startSpan(name: string, attributes?: Record<string, any>): any;
    
    /**
     * Get the current log level
     * @returns The current log level
     */
    getLevel(): number;
    
    /**
     * Set the log level
     * @param level The new log level
     */
    setLevel(level: number): void;
}