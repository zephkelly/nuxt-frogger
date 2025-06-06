import type { FroggerOptions } from "../../shared/types/options";

import type { LogContext } from "../../shared/types/log";
import type { AppInfoOptions, ExtractedAppInfo } from "../../app-info/types";



export interface ClientLoggerOptions extends FroggerOptions {
    /**
     * API endpoint to send logs to
     * @default '/api/_logger/logs'
     */
    endpoint?: string;

    appInfo?: {
        /**
         * Application name
         * @default 'unknown'
         */
        name?: string;

        /**
         * Application version
         * @default 'unknown'
         */
        version?: string;
    }
}


export interface QueuedLog {
    type: string;
    timestamp: number;
    trace: {
        traceId: string;
        spanId: string;
    }
    context: LogContext;
}