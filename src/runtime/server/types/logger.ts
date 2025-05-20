import type { FroggerOptions } from "../../shared/types/options";
import type { FroggerLogger } from "../../shared/types/frogger";
import type { LogObject } from "consola";


/**
 * Server-side implementation of Frogger
 * Handles logs directly using configured reporters
 */
export interface ServerLoggerOptions extends FroggerOptions {
    /**
     * Enable file logging
     */
    file?: boolean | {
        directory?: string;
        fileNameFormat?: string;
        maxSize?: number;
        format?: 'json' | 'text';
    };
    
    /**
     * Enable batch reporting to external services
     */
    batch?: boolean | {
        maxSize?: number;
        maxAge?: number;
        retryOnFailure?: boolean;
        maxRetries?: number;
        retryDelay?: number;
    };
    
    /**
     * HTTP endpoint for batch reporting
     */
    endpoint?: string;
    
    /**
     * Additional fields to include with all logs
     */
    additionalFields?: Record<string, any>;
}


export interface ServerLogger extends FroggerLogger {
}