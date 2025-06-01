import type { LogType } from "consola";
import type { TraceContext } from "./trace";



export interface LogContext {
    type?: LogType;
    env?: 'ssr' | 'client' | 'server';
    [key: string]: any
}

export interface LoggerObject {
    time: number;
    lvl: number;
    msg?: string;
    ctx: LogContext;
    trace: TraceContext;
}