import type { LogType } from 'consola'

import type { IFroggerLogger } from '../../logger/types'
import { monotonicNow, elapsedMs } from './now'

import type { SpanMetricLabels } from './span-metric-sink'

/**
 * Resolved `spans` module option: `false` disables span-end events, otherwise
 * the level they are emitted at plus whether each span also records a
 * `span.duration` histogram.
 */
export type ResolvedSpanEvents = false | { level: LogType, metric: boolean }

export const DEFAULT_SPAN_EVENTS: ResolvedSpanEvents = { level: 'info', metric: false }

/**
 * Read the resolved `spans` value back out of runtime config.
 *
 * Deliberately tolerant rather than a cast: a published module can be running
 * against a runtimeConfig written by an older build of itself, where `metric`
 * does not exist yet, and a missing key must degrade to the default rather
 * than produce `undefined` where a boolean is expected.
 */
export function spanEventsFromConfig(value: unknown): ResolvedSpanEvents {
    if (value === false) return false

    if (typeof value === 'object' && value !== null) {
        const partial = value as { level?: LogType, metric?: boolean }
        return {
            level: partial.level ?? (DEFAULT_SPAN_EVENTS as { level: LogType }).level,
            metric: partial.metric ?? false,
        }
    }

    return structuredClone(DEFAULT_SPAN_EVENTS)
}

/** Per-call options for {@link IFroggerLogger.span}. */
export interface SpanOptions {
    /**
     * Record a `span.duration` histogram for this span, overriding the module
     * default. Requires the metrics subsystem; without it there is no sink and
     * the flag is inert.
     */
    metric?: boolean

    /**
     * Extra indexed labels on that histogram. `span` and `ok` are added for
     * you, so these are for dimensions the span name cannot carry.
     */
    labels?: SpanMetricLabels
}

/**
 * Run a `span()` body and emit one span-end event on the span's child logger,
 * OTel-style: every span produces exactly one row carrying its duration and
 * ok/error status, so a span is visible even when nothing logs inside it.
 *
 * The thrown error itself is NOT attached: it propagates to the caller, whose
 * handler (or the global error capture) owns reporting it. `ok: false` plus
 * the shared trace is enough to correlate the two rows.
 *
 * `onEnd` receives the same duration in seconds (the metric base unit) and is
 * what turns an existing span call site into latency data. It runs even when
 * `spanEvents` is `false`: an app that pins span-end rows below its log level
 * to keep volume down is exactly the app that still wants the histogram.
 */
export async function runSpanWithEvent<T>(
    child: IFroggerLogger,
    name: string,
    spanEvents: ResolvedSpanEvents,
    run: () => Promise<T>,
    onEnd?: (durationSeconds: number, ok: boolean) => void,
): Promise<T> {
    if (!spanEvents && !onEnd) {
        return run()
    }

    const start = monotonicNow()
    try {
        const result = await run()
        finish(child, name, spanEvents, start, true, onEnd)
        return result
    }
    catch (error) {
        finish(child, name, spanEvents, start, false, onEnd)
        throw error
    }
}

function finish(
    child: IFroggerLogger,
    name: string,
    spanEvents: ResolvedSpanEvents,
    start: number,
    ok: boolean,
    onEnd?: (durationSeconds: number, ok: boolean) => void,
): void {
    const durationMs = elapsedMs(start)

    if (spanEvents) {
        child.logLevel(spanEvents.level, name, { spanEvent: 'end', durationMs, ok })
    }

    if (!onEnd) return
    try {
        onEnd(durationMs / 1000, ok)
    }
    catch {
        // A metrics sink must never break the span it is measuring.
    }
}
