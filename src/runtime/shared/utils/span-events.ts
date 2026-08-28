import type { LogType } from 'consola'

import type { IFroggerLogger } from '../../logger/types'
import { monotonicNow, elapsedMs } from './now'

import type { SpanMetricLabels, SpanExemplar } from './span-metric-sink'
import { parseTraceparent } from './trace-headers'
import { emitSpan, getSpanSink } from './span-sink'
import { boundSpanAttributes, type SpanKind, type SpanObject } from '../types/span'
import { uuidv7 } from './uuid'

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

    /**
     * What kind of work this span represents. @default 'internal'
     */
    kind?: SpanKind

    /**
     * Span-scoped attributes, carried on the {@link SpanObject} and distinct
     * from the log context of rows inside the span. Bounded.
     */
    attributes?: Record<string, unknown>
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
 *
 * It also receives the span child's OWN exemplar. `finish` runs after `run()`
 * has resolved, which is after the child's context scope has exited, so a sink
 * that resolved the trace ambiently would attribute every span's latency to
 * its parent.
 */
export async function runSpanWithEvent<T>(
    child: IFroggerLogger,
    name: string,
    spanEvents: ResolvedSpanEvents,
    run: () => Promise<T>,
    onEnd?: (durationSeconds: number, ok: boolean, trace?: SpanExemplar) => void,
    options?: SpanOptions,
): Promise<T> {
    // A span record is emitted whenever a sink is registered, independently of
    // whether span-END LOG ROWS are on: `spans: false` is about log volume, not
    // about whether the span happened.
    const wantsSpanRecord = getSpanSink() !== null

    if (!spanEvents && !onEnd && !wantsSpanRecord) {
        return run()
    }

    const start = monotonicNow()
    const startedAt = Date.now()

    try {
        const result = await run()
        finish(child, name, spanEvents, start, startedAt, true, onEnd, options)
        return result
    }
    catch (error) {
        finish(child, name, spanEvents, start, startedAt, false, onEnd, options, error)
        throw error
    }
}

function finish(
    child: IFroggerLogger,
    name: string,
    spanEvents: ResolvedSpanEvents,
    start: number,
    startedAt: number,
    ok: boolean,
    onEnd?: (durationSeconds: number, ok: boolean, trace?: SpanExemplar) => void,
    options?: SpanOptions,
    error?: unknown,
): void {
    const durationMs = elapsedMs(start)

    if (spanEvents) {
        child.logLevel(spanEvents.level, name, { spanEvent: 'end', durationMs, ok })
    }

    emitSpanRecord(child, name, startedAt, durationMs, ok, options, error)

    if (!onEnd) return
    try {
        // Resolved from the span's own child AFTER its end row, so the exemplar
        // points at a row that exists rather than at a reserved id.
        onEnd(durationMs / 1000, ok, exemplarOf(child))
    }
    catch {
        // A metrics sink must never break the span it is measuring.
    }
}

/**
 * Build and emit the span as a record.
 *
 * A span-end LOG ROW can carry a name, a duration and a boolean. This carries
 * the start timestamp, the kind, a real status with a message, and a bounded
 * span-scoped attribute bag - the things a span model needs and a log row
 * cannot express.
 */
function emitSpanRecord(
    child: IFroggerLogger,
    name: string,
    startTime: number,
    durationMs: number,
    ok: boolean,
    options?: SpanOptions,
    error?: unknown,
): void {
    if (!getSpanSink()) return

    let context: ReturnType<IFroggerLogger['getSpanContext']> | undefined
    try {
        context = child.getSpanContext()
    }
    catch {
        return
    }

    if (!context?.traceId || !context.spanId) return

    const attributes = boundSpanAttributes({
        ...options?.attributes,
        ...collectAttributes(child),
    })

    const span: SpanObject = {
        id: uuidv7(),
        traceId: context.traceId,
        spanId: context.spanId,
        ...(context.parentSpanId ? { parentSpanId: context.parentSpanId } : {}),
        name,
        kind: options?.kind ?? 'internal',
        startTime,
        endTime: startTime + Math.round(durationMs),
        status: ok
            ? { code: 'ok' }
            : { code: 'error', message: error instanceof Error ? error.message : undefined },
        ...(attributes ? { attributes } : {}),
        env: envOf(child),
    }

    emitSpan(span)
}

/** Attributes a span picked up via `setAttribute()` on its handle. */
function collectAttributes(child: IFroggerLogger): Record<string, unknown> | undefined {
    return (child as unknown as { spanAttributes?: Record<string, unknown> }).spanAttributes
}

function envOf(child: IFroggerLogger): SpanObject['env'] {
    const scope = (child as unknown as { getConsoleScope?: () => 'client' | 'server' }).getConsoleScope?.()
    return scope === 'server' ? 'server' : 'client'
}

/** The span child's own `{traceId, spanId, flags}`, or nothing if unavailable. */
function exemplarOf(child: IFroggerLogger): SpanExemplar | undefined {
    try {
        const traceparent = child.getHeaders().traceparent
        if (!traceparent) return undefined

        const parsed = parseTraceparent(traceparent)
        if (!parsed) return undefined

        return { traceId: parsed.traceId, spanId: parsed.spanId, flags: parsed.flags }
    }
    catch {
        return undefined
    }
}
