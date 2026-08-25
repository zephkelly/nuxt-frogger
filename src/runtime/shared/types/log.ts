import type { LogType } from "consola";
import type { TraceContext } from "./trace-headers";



export interface LogContext {
    [key: string]: any
}

// Stamped by an in-process server logger once its own scrub disposition (its
// rules, or an explicit `scrub: false`) has been applied, so the queue's
// module-level pass doesn't override a per-logger opt-out. A symbol key:
// network batches are parsed from JSON and can never carry it, so client rows
// always get the queue's unconditional scrub. The queue strips it before any
// transport sees the row. Symbol.for keeps the marker recognisable even if
// the runtime is bundled twice.
export const SCRUB_HANDLED: unique symbol = Symbol.for('frogger:scrub-handled');

export interface LoggerObject {
    time: number;
    lvl: number;
    type: LogType;
    msg: string;
    ctx: LogContext;
    tags?: string[];
    env: 'ssr' | 'csr' | 'client' | 'server';
    source?: {
        name: string;
        version: string;
    };
    trace: TraceContext;
    [SCRUB_HANDLED]?: true;
}

export const LOG_LEVELS = {
    0: ['fatal', 'error'],
    1: ['warn'],
    2: ['log'],
    3: ['info', 'success', 'fail', 'ready', 'start'],
    4: ['debug'],
    5: ['trace'],
    999: ['verbose'],
    '-999': ['silent']
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
    'trace': 5,
    'verbose': 999,
    'silent': -999
};