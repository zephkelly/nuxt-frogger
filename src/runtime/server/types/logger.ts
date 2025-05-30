import type { FroggerOptions } from "../../shared/types/options";
import type { FroggerLogger } from "../../shared/types/frogger";


/**
 * Server-side implementation of Frogger
 * Handles logs directly using configured reporters
 */
export interface ServerLoggerOptions extends FroggerOptions {
    
}


export interface ServerLogger extends FroggerLogger {
}