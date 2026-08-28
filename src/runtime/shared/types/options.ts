import type { LogType } from "consola";
import type { LogContext } from "./log";
import type { ScrubberOptions } from "../../scrubber/options";


export interface FroggerOptions {
    /**
     * Threshold for this logger, overriding the module-wide `level`. Accepts a
     * level name (`'debug'`) or frogger's numeric level; names are preferred,
     * numbers are the low-level escape hatch.
     */
    level?: LogType | number;
    context?: LogContext;
    scrub?: ScrubberOptions | boolean;
    consoleOutput?: boolean;
}