/**
 * Trace context following W3C Trace Context specification
 */
export interface TraceContext {
    /**
     * Trace ID - unique identifier for the whole trace
     * 16-byte array as 32-character hex string
     */
    traceId: string;
    
    /**
     * Span ID - unique identifier for this specific operation
     * 8-byte array as 16-character hex string
     */
    spanId: string;
    
    /**
     * Parent Span ID - reference to the parent operation
     * 8-byte array as 16-character hex string (optional)
     */
    parentId?: string;
    
    /**
     * Whether this trace is sampled for storage/processing
     */
    sampled?: boolean;
}

export interface LogContext {
    userId?: string
    sessionId?: string
    [key: string]: any
}


export interface FroggerOptions {
    level?: number;
    context?: LogContext;
}

export interface Frogger {
    fatal(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
    info(...args: any[]): void;
    debug(...args: any[]): void;
    trace(...args: any[]): void;
    
    addContext(context: LogContext): void;
    setUser(userId: string): void;
    setSession(sessionId: string): void;
    
    startSpan(name: string, attributes?: Record<string, any>): any;
    
    getLevel(): number;
    setLevel(level: number): void;
}






/**
 * Severity levels for logs
 */
export enum LogLevel {
    FATAL = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
    TRACE = 5
}

/**
 * Map of log type names to their level
 */
export const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    fatal: LogLevel.FATAL,
    error: LogLevel.ERROR,
    warn: LogLevel.WARN,
    info: LogLevel.INFO,
    debug: LogLevel.DEBUG,
    trace: LogLevel.TRACE,
    // Add any additional log types you want to support
    log: LogLevel.INFO,
    success: LogLevel.INFO,
    ready: LogLevel.INFO,
    start: LogLevel.INFO
};

/**
 * User context information
 */
export interface UserContext {
    /**
     * User identifier (if authenticated)
     */
    userId?: string;
    
    /**
     * Session identifier
     */
    sessionId?: string;
    
    /**
     * User agent string
     */
    userAgent?: string;
}

/**
 * HTTP request context
 */
export interface HttpContext {
    /**
     * HTTP method (GET, POST, etc.)
     */
    method?: string;
    
    /**
     * Request URL
     */
    url?: string;
    
    /**
     * HTTP status code
     */
    statusCode?: number;
    
    /**
     * Request headers
     */
    headers?: Record<string, string>;
    
    /**
     * Response time in milliseconds
     */
    responseTime?: number;
}

/**
 * Error context
 */
export interface ErrorContext {
    /**
     * Error name/type
     */
    name?: string;
    
    /**
     * Error message
     */
    message?: string;
    
    /**
     * Error stack trace
     */
    stack?: string;
    
    /**
     * Error code if available
     */
    code?: string | number;
}

/**
 * Application context
 */
export interface AppContext {
    /**
     * Application name
     */
    appName?: string;
    
    /**
     * Application version
     */
    version?: string;
    
    /**
     * Environment (development, production, etc.)
     */
    environment?: string;
    
    /**
     * Component or module name
     */
    component?: string;
}

/**
 * Main log object interface
 */
export interface LogObject {
    /**
     * Log timestamp (ISO string or epoch milliseconds)
     */
    timestamp: string | number;
    
    /**
     * Log type/level name (error, warn, info, etc.)
     */
    type: string;
    
    /**
     * Log level as numeric value
     */
    level: LogLevel;
    
    /**
     * Log message
     */
    message: string;
    
    /**
     * Additional args passed to logger
     */
    args?: any[];
    
    /**
     * Trace context for distributed tracing
     */
    trace?: TraceContext;
    
    /**
     * User context information
     */
    user?: UserContext;
    
    /**
     * HTTP request context
     */
    http?: HttpContext;
    
    /**
     * Error details (for error logs)
     */
    error?: ErrorContext;
    
    /**
     * Application context
     */
    app?: AppContext;
    
    /**
     * Additional context data
     */
    context?: Record<string, any>;
    
    /**
     * Log tags for filtering/grouping
     */
    tags?: string[];
    
    /**
     * Source of the log (client/server)
     */
    source?: 'client' | 'server';
}
