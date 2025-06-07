import type { LogType } from "consola";
import type { TraceContext } from "./trace-headers";



export interface LogContext {
    [key: string]: any
}

export interface LoggerObject {
    time: number;
    lvl: number;
    type: LogType;
    msg?: string;
    ctx: LogContext;
    trace: TraceContext;
    source?: string;
    tags?: string[];
    env: 'ssr' | 'csr' | 'client' | 'server';
}

export const LOG_LEVELS = {
    0: ['fatal', 'error'],
    1: ['warn'],
    2: ['log'],
    3: ['info', 'success', 'fail', 'ready', 'start'],
    4: ['debug'],
    5: ['trace']
} as const;

export const LEVEL_TO_NUMBER: Record<string, number> = {
    'fatal': 0,
    'error': 0,
    'warn': 1,
    'log': 2,
    'info': 3,
    'success': 3,
    'fail': 3,
    'ready': 3,
    'start': 3,
    'debug': 4,
    'trace': 5
};