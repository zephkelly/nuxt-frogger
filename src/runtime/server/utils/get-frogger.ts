import { defu } from 'defu';
import { isEvent } from "h3";
import type { H3Event } from "h3";
import { useFroggerConfig } from '../../shared/utils/use-frogger-config';
import { useEvent } from 'nitropack/runtime/internal/context';

import { ServerFroggerLogger } from "../../logger/server";
import { getActiveLogger } from '../../logger/active-context.server';

import type { IFroggerLogger } from '../../logger/types';
import type { TraceContext } from "../../shared/types/trace-headers";
import type { ServerLoggerOptions } from "../types/logger";



/**
 * Get a Frogger logger instance.
 *
 * The event may be passed in either position. With
 * `serverModule.autoEventCapture` on (the default) it can be omitted entirely
 * and is recovered from Nitro's async context; with it off, Nitro has no async
 * context at all, `useEvent()` throws, and the logger simply starts a fresh
 * trace - which is exactly what that option means.
 *
 * Both overload orders resolve through one implementation. h3's `isEvent()`
 * brand check disambiguates the positions, so the two argument orders were
 * never two functions - they were one function declared twice.
 *
 * @param event H3Event used to continue the incoming trace.
 * @param options Logger options; these win over runtime config.
 */
export function getFrogger(event?: H3Event, options?: ServerLoggerOptions): IFroggerLogger;
export function getFrogger(options?: ServerLoggerOptions, event?: H3Event): IFroggerLogger;

export function getFrogger(
    eventOrOptions?: H3Event | ServerLoggerOptions,
    optionsOrEvent?: ServerLoggerOptions | H3Event
): IFroggerLogger {
    // h3's brand check, not a `'context' in x` sniff: `context` is a documented
    // ServerLoggerOptions field, so sniffing it mistook real options objects
    // for events and silently dropped the caller's options (scrub included).
    let event = isEvent(eventOrOptions)
        ? eventOrOptions
        : isEvent(optionsOrEvent) ? optionsOrEvent : undefined;

    if (!event) {
        // useEvent() THROWS outside a request context (nitro plugin init, cron
        // tasks, startup code) rather than returning undefined. A logger with
        // no ambient event is valid there — it just starts a fresh trace.
        try {
            event = useEvent();
        }
        catch {
            event = undefined;
        }
    }

    const rawOptions = isEvent(eventOrOptions) ? optionsOrEvent : eventOrOptions;
    const options = isEvent(rawOptions) ? undefined : rawOptions as ServerLoggerOptions | undefined;

    const config = useFroggerConfig();

    const runtimeBatchOptions = config.batch;
    const runtimeEndpoint = config.endpoint;

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

    const traceContext = event?.context?.frogger as TraceContext | undefined;

    if (traceContext) {
        const logger = new ServerFroggerLogger(mergedOptions, traceContext);
        adoptInboundTracestate(logger, event);
        adoptRequestSession(logger, event);
        return logger;
    }

    return new ServerFroggerLogger(mergedOptions);
}

/**
 * Carry the request's inbound `tracestate` onto the logger so an outbound
 * `getHeaders()` prepends frogger's entry rather than discarding every other
 * vendor's state at this hop.
 */
/**
 * Attach the request's validated session to a server logger, so rows emitted on
 * the server carry the same `session` as the client rows that triggered them.
 *
 * That is the browser session unless the client pinned another id via
 * `setSession()`, in which case this adopts whatever the client sent - which is
 * the point: the two sides agree without the server being configured for it.
 */
export function adoptRequestSession(logger: IFroggerLogger, event?: H3Event): void {
    const session = event?.context?.froggerSession as { id: string, sampled: boolean } | undefined;
    if (!session) return;

    logger.setSession(session);
}

export function adoptInboundTracestate(logger: IFroggerLogger, event?: H3Event): void {
    const inbound = event?.context?.froggerTracestate as string | undefined;
    if (!inbound) return;

    (logger as unknown as { inboundTracestate?: string }).inboundTracestate = inbound;
}
