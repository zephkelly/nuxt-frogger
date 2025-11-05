

import { defu } from 'defu';
import type { H3Event } from "h3";
import { useRuntimeConfig } from '#imports';
import { useEvent } from 'nitropack/runtime/internal/context';

import { ServerFroggerLogger } from "../../logger/server";

import type { IFroggerLogger } from '../../logger/types';
import type { TraceContext } from "../../shared/types/trace-headers";
import type { ServerLoggerOptions } from "../types/logger";


/**
 * Get a Frogger logger instance
 * @param event H3Event use to propagate trace context automatically. To avoid passing the event,
 * set 'frogger.serverModule.autoCaptureContext' to false in your module options / runtime config.
 * @param options Optional logger options to override runtime config
*/
export function getFrogger(event?: H3Event, options?: ServerLoggerOptions): IFroggerLogger;

/**
 * @deprecated Using getFrogger without an event parameter prevents proper trace context propagation.
 * Please pass the event object from your api route like so: getFrogger(event)
 */
export function getFrogger(event?: H3Event, options?: ServerLoggerOptions): IFroggerLogger;

export function getFrogger(
    eventOrOptions?: H3Event | ServerLoggerOptions,
    maybeOptions?: ServerLoggerOptions
): IFroggerLogger {
    const isEvent = eventOrOptions && 'context' in eventOrOptions;
    
    let event = isEvent ? eventOrOptions as H3Event : undefined;

    if (!event) {
        event = useEvent();
    }


    const options = isEvent ? maybeOptions : eventOrOptions as ServerLoggerOptions;

    const config = useRuntimeConfig();

    //@ts-ignore
    const runtimeFileOptions = config.frogger.file;
    //@ts-ignore
    const runtimeBatchOptions = config.public.frogger.batch;
    //@ts-ignore
    const runtimeEndpoint = config.public.frogger.endpoint;

    const froggerOptions = {
        file: runtimeFileOptions,
        batch: runtimeBatchOptions,
        endpoint: runtimeEndpoint,
    }

    const mergedOptions = defu(froggerOptions, options) as ServerLoggerOptions;
    
    let traceContext: TraceContext | undefined;
    if (event?.context?.frogger) {
        traceContext = event.context.frogger;
    }
    
    if (traceContext) {
        return new ServerFroggerLogger(mergedOptions, traceContext);
    }
    

    return new ServerFroggerLogger(mergedOptions);
}