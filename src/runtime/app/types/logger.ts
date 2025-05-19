import type { LogContext } from "../../shared/types";
import type { FroggerOptions } from "../../shared/types";
import type { FroggerLogger } from "../../shared/types/frogger";



export interface ClientLoggerOptions extends FroggerOptions {
    /**
     * API endpoint to send logs to
     * @default '/api/_logger/logs'
     */
    endpoint?: string;
    
    /**
     * Maximum number of logs to batch before sending
     * @default 10
     */
    maxBatchSize?: number;
    
    /**
     * Maximum time (ms) to wait before sending a batch
     * @default 3000
     */
    maxBatchAge?: number;
    
    /**
     * Maximum number of logs to store in memory
     * @default 100
     */
    maxQueueSize?: number;
    
    /**
     * Application name/service to include with logs
     */
    appName?: string;
    
    /**
     * Application version
     */
    version?: string;
    
    /**
     * Whether to automatically capture unhandled errors
     * @default true
     */
    captureErrors?: boolean;
    
    /**
     * Whether to automatically capture console methods
     * @default false
     */
    captureConsole?: boolean;
}

export interface QueuedLog {
    type: string;
    date: Date;
    timestamp: number;
    trace: {
        traceId: string;
        spanId: string;
    }
    context: LogContext;
}

export interface ClientLogger extends FroggerLogger {
    
}