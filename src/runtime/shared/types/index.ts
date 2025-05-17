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