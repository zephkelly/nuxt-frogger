import type { LogObject } from 'consola';
import type { LoggerObject } from '../../shared/types';



export interface BatchReporterOptions {
    /**
     * Maximum number of logs to keep before flushing
     * @default 100
     */
    maxSize?: number;
    
    /**
     * Maximum time in milliseconds before flushing logs
     * @default 5000 (5 seconds)
     */
    maxAge?: number;
    
    /**
     * Function to call when flushing logs
     */
    onFlush: (logs: LoggerObject[]) => Promise<void>;
    
    /**
     * Whether to include trace context in flushed logs
     * @default true
     */
    includeTraceContext?: boolean;
    
    /**
     * Additional fields to include in all logs
     */
    additionalFields?: Record<string, any>;
    
    /**
     * Log levels to include (undefined means all levels)
     */
    levels?: number[];
    
    /**
     * Whether to retry failed flush operations
     * @default true
     */
    retryOnFailure?: boolean;
    
    /**
     * Maximum number of retry attempts
     * @default 3
     */
    maxRetries?: number;
    
    /**
     * Base delay between retries in milliseconds (will use exponential backoff)
     * @default 1000 (1 second)
     */
    retryDelay?: number;
}