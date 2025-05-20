import type { LogType } from "consola";
import type { TraceContext } from "./trace";



export interface LogContext {
    message?: string;
    env?: 'ssr' | 'client' | 'server';
    [key: string]: any
}

export interface LoggerObject {
    type: LogType;
    date: Date;
    level: number;
    trace: TraceContext;
    context: LogContext;
    timestamp: number;
}