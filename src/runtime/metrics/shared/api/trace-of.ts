import type { IFroggerLogger } from '../../../logger/types'

/**
 * The exemplar for a point recorded under `logger`.
 *
 * Reads the logger's own stable span identity. It used to round-trip through
 * `getHeaders()` and re-parse the traceparent, which meant the span id was
 * whatever row had been emitted last - so a metric recorded before a span's
 * first log pointed at the parent span instead of the span itself, and the
 * sampling decision was discarded by the parse.
 *
 * Still an exemplar, not a foreign key: the referenced trace's logs may not
 * exist (a sampled-out session still emits metrics).
 */
export function traceFromLogger(
    logger: IFroggerLogger,
): { traceId: string, spanId?: string, flags?: string } | undefined {
    try {
        const span = logger.getSpanContext?.()
        if (span?.traceId) {
            return { traceId: span.traceId, spanId: span.spanId, flags: span.flags }
        }
    }
    catch {
        // A logger without a span context simply yields no exemplar.
    }
    return undefined
}
