import type { FroggerOptions } from "../../shared/types/options";

import type { LogContext } from "../../shared/types/log";
// import type { AppInfoOptions, ExtractedAppInfo } from "../../app-info/types";



export interface ClientLoggerOptions extends FroggerOptions {
    /**
     * Ingest route the browser POSTs to. `false` when the client POST is
     * deliberately disabled (`public.endpoint: false`), which is a real
     * resolved value, not an absent one - `hasPrimaryLogSink` treats it as
     * "no primary sink" while client transports still fan out.
     *
     * @default '/api/_frogger/logs'
     */
    endpoint?: string | false;

    baseUrl?: string;
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

export interface SSRTraceState {
    traceId: string;
    lastServerSpanId: string | null;
    isClientHydrated: boolean;
}