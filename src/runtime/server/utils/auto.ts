import { defu } from 'defu';
import { isEvent } from "h3";
import type { H3Event } from "h3";
import { useRuntimeConfig } from '#imports';
import { useEvent } from 'nitropack/runtime/internal/context';

import { ServerFroggerLogger } from "../../logger/server";
import { getActiveLogger } from '../../logger/active-context.server';

import type { IFroggerLogger } from '../../logger/types';
import type { TraceContext } from "../../shared/types/trace-headers";
import type { ServerLoggerOptions } from "../types/logger";



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
    optionsOrEvent?: ServerLoggerOptions | H3Event
): IFroggerLogger {
    // h3's brand check, not a `'context' in x` sniff: `context` is a documented
    // ServerLoggerOptions field, so sniffing it mistook real options objects
    // for events and silently dropped the caller's options (scrub included).
    // The event is accepted in either position, matching both overload orders.
    let event = isEvent(eventOrOptions)
        ? eventOrOptions
        : isEvent(optionsOrEvent) ? optionsOrEvent : undefined;

    if (!event) {
        event = useEvent();
    }

    const rawOptions = isEvent(eventOrOptions) ? optionsOrEvent : eventOrOptions;
    const options = isEvent(rawOptions) ? undefined : rawOptions as ServerLoggerOptions | undefined;

    const config = useRuntimeConfig();

    //@ts-ignore
    const runtimeBatchOptions = config.public.frogger.batch;
    //@ts-ignore
    const runtimeEndpoint = config.public.frogger.endpoint;

    const froggerOptions = {
        batch: runtimeBatchOptions,
        endpoint: runtimeEndpoint,
    }

    // Caller options win over runtime config, as the JSDoc promises.
    const mergedOptions = defu(options, froggerOptions) as ServerLoggerOptions;

    // Inside frogger.span(...), continue the span tree instead of re-branching
    // from the request root. Outside a span, behavior is unchanged.
    const active = getActiveLogger();
    if (active) {
        return active.child(mergedOptions);
    }

    let traceContext: TraceContext | undefined;
    if (event?.context?.frogger) {
        traceContext = event.context.frogger;
    }

    if (traceContext) {
        return new ServerFroggerLogger(mergedOptions, traceContext);
    }


    return new ServerFroggerLogger(mergedOptions);
}