import { ServerFroggerLogger } from "./server-frogger";
import type { ServerLoggerOptions } from "../types/logger";
import type { ServerLogger } from "../types/logger";
import type { H3Event } from "h3";
import type { TraceContext } from "../../shared/types";



/**
 * Get a Frogger logger instance
 * @param event H3Event context for tracing
 */
export function getFrogger(event: H3Event, options?: ServerLoggerOptions): ServerLogger;

/**
 * @deprecated Using getFrogger without an event parameter prevents proper trace context propagation.
 * Please pass the event object from your api route like so: getFrogger(event)
 */
export function getFrogger(options?: ServerLoggerOptions): ServerLogger;

export function getFrogger(
    eventOrOptions?: H3Event | ServerLoggerOptions,
    maybeOptions?: ServerLoggerOptions
): ServerLogger {
    const isEvent = eventOrOptions && 'context' in eventOrOptions;
    
    const event = isEvent ? eventOrOptions as H3Event : undefined;
    const options = isEvent ? maybeOptions : eventOrOptions as ServerLoggerOptions;
    
    let traceContext: TraceContext | undefined;
    if (event?.context?.frogger) {
        traceContext = event.context.frogger;
    }
    
    if (traceContext) {
        return new ServerFroggerLogger(options, traceContext);
    }
    

    return new ServerFroggerLogger(options);
}