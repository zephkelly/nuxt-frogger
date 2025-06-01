import type { LoggerObject } from "./log";



export interface IFroggerReporter {
    log: (loggerObject: LoggerObject) => void | Promise<void>;
}