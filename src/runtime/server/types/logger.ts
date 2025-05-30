import type { FroggerOptions } from "../../shared/types/options";
import type { FroggerLogger } from "../../shared/types/frogger";


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
    };
    
    /**
     * Enable batch reporting to external services
     */
    batch?: {
        maxSize?: number;
        maxAge?: number;
        retryOnFailure?: boolean;
        maxRetries?: number;
        retryDelay?: number;
        sortingWindowMs?: number;
    };
    
    /**
     * (Internal use only, currently) endpoint to direct logs to
     */
    endpoint?: string;
}


export interface ServerLogger extends FroggerLogger {
}