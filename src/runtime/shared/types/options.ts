import type { LogContext } from "./log";
import type { ScrubberOptions } from "../../scrubber/options";


export interface FroggerOptions {
    level?: number;
    context?: LogContext;
    scrub?: ScrubberOptions | boolean;
    consoleOutput?: boolean;
}