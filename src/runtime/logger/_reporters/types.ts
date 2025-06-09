import type { LoggerObject } from "../../shared/types/log";
import type { Prettify } from "../../shared/types/prettify";



export interface IFroggerReporter {
    log: (loggerObject: Prettify<LoggerObject>) => void | Promise<void>;
}