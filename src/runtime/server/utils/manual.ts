import { defu } from 'defu';
import type { H3Event } from "h3";
import { useRuntimeConfig } from '#imports';

import { ServerFroggerLogger } from "./server-logger";
import { ServerLogQueueService } from '../services/server-log-queue';

import { HttpReporter, defaultHttpReporterOptions } from "./reporters/http-reporter";
import type { HttpReporterOptions } from "../types/http-reporter";

import type { IFroggerLogger } from "../../shared/types/frogger";
import type { IReporter } from '../../shared/types/internal-reporter';
import type { TraceContext } from "../../shared/types/trace-headers";
import type { ServerLoggerOptions } from "../types/logger";




/**
 * Get a Frogger logger instance
 * @param event H3Event context for tracing
 */
export function getFrogger(event: H3Event, options?: ServerLoggerOptions): IFroggerLogger;

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
    
    const event = isEvent ? eventOrOptions as H3Event : undefined;
    const options = isEvent ? maybeOptions : eventOrOptions as ServerLoggerOptions;

    const config = useRuntimeConfig();

    const runtimeFileOptions = config.frogger.file;
    const runtimeBatchOptions = config.public.frogger.batch;
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




// Add reporter 
export function addGlobalReporter(reporter: IReporter): void {
    const logQueue = ServerLogQueueService.getInstance();

    logQueue.addReporter(reporter);
}


export function createHttpReporter(endpoint: string): HttpReporter;

export function createHttpReporter(options: HttpReporterOptions): HttpReporter;

export function createHttpReporter(endpointOrOptions: string | HttpReporterOptions): HttpReporter {
    if (typeof endpointOrOptions === 'string') {
        const options: HttpReporterOptions = {
            ...defaultHttpReporterOptions,
            endpoint: endpointOrOptions,
        };

        return new HttpReporter(options);
    }
    else {
        return new HttpReporter(endpointOrOptions);
    }
}