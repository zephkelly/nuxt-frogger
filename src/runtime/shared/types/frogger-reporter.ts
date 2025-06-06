import type { LoggerObject } from "./log";
import type { Prettify } from "./prettify";



export interface IFroggerReporter {
    log: (loggerObject: Prettify<LoggerObject>) => void | Promise<void>;
}