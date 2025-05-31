import type { LoggerObject } from "./log";


export interface BatchOptions {
    maxSize?: number
    maxAge?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
    sortingWindowMs?: number
}

export interface LoggerObjectBatch {
    logs: LoggerObject[];
    app: {
        name: string;
        version: string;
    }
}