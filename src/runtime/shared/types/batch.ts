import type { LoggerObject } from "./log";



export interface LogBatch {
    logs: LoggerObject[];
    app: {
        name: string;
        version: string;
    }
}