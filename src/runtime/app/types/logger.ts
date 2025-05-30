import type { FroggerOptions } from "../../shared/types/options";
import type { FroggerLogger } from "../../shared/types/frogger";

import type { LogContext } from "../../shared/types/log";



export interface ClientLoggerOptions extends FroggerOptions {
    /**
     * API endpoint to send logs to
     * @default '/api/_logger/logs'
     */
    endpoint?: string;
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