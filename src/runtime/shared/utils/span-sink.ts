import type { SpanObject } from '../types/span'

/**
 * Receives a completed {@link SpanObject}.
 *
 * The same indirection pattern as `span-metric-sink`, and for the same reason:
 * `runSpanWithEvent` lives in the logger tree and must not know how a span
 * reaches a queue. Each runtime registers its own sink at plugin init.
 *
 * A null sink is the normal state for a bare install.
 */
export type SpanSink = (span: SpanObject) => void

let sink: SpanSink | null = null

export function setSpanSink(fn: SpanSink | null): void {
    sink = fn
}

export function getSpanSink(): SpanSink | null {
    return sink
}

/** Hand a completed span to the sink. Never throws into the span it measured. */
export function emitSpan(span: SpanObject): void {
    if (!sink) return

    try {
        sink(span)
    }
    catch {
        // A span record must never break the code it was measuring.
    }
}
