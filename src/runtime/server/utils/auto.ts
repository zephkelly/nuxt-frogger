import { defu } from 'defu';
import type { H3Event } from "h3";

import { ServerFroggerLogger } from "../../logger/server";

import type { IFroggerLogger } from '../../logger/types';
import type { TraceContext } from "../../shared/types/trace-headers";
import type { ServerLoggerOptions } from "../types/logger";


import { useEvent } from 'nitropack/runtime/internal/context';

/**
 * Get a Frogger logger instance
 * @param options Optional logger options to override runtime config
 * @param event Event context is captured automatically via 'useEvent()', pass it in manually
 * if you want to override this, or set 'frogger.serverModule.autoCaptureContext' to false in
 * your module options / runtime config.
 */
export function getFrogger(options?: ServerLoggerOptions, event?: H3Event): IFroggerLogger;

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