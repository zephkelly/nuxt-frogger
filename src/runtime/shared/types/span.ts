import type { FroggerResource } from './resource'

/**
 * What kind of work a span represents. Narrow on purpose: `internal` (in-process
 * work), `server` (handling an inbound request) and `client` (making an outbound
 * one) are the three frogger can actually produce today. OTel's `producer` and
 * `consumer` are added when there is a queue integration to justify them.
 */
export type SpanKind = 'internal' | 'server' | 'client'

/**
 * Span status. Follows OTel's TOTAL ORDER: once `error`, a later `ok` cannot
 * downgrade it - otherwise a handler that swallows a failure at the end of a
 * span erases the fact that it happened.
 */
export interface SpanStatus {
    code: 'unset' | 'ok' | 'error'
    message?: string
}

/**
 * A span as a first-class record.
 *
 * Previously a span's only representation as a unit was an optional log row
 * emitted by `finish()`, which could express a name, a duration and a boolean -
 * and nothing else. No start timestamp (only end minus a duration the reader
 * had to subtract), no kind, no status beyond ok/not-ok, no span-scoped
 * attributes, and with `spans: false` no trace of the span at all.
 *
 * Carried in the EXISTING `LoggerObjectBatch`, not a new pipeline: no new
 * route, no new transport, no generic three-signal abstraction.
 */
export interface SpanObject {
    /** uuidv7, like every other record: a stable dedupe and sort key. */
    id: string

    traceId: string
    spanId: string
    parentSpanId?: string

    name: string
    kind: SpanKind

    /** Epoch ms. Present, rather than derived by subtraction at read time. */
    startTime: number
    endTime: number

    status: SpanStatus

    /**
     * Span-scoped attributes, distinct from the log context of rows inside the
     * span. Bounded ({@link MAX_SPAN_ATTRIBUTES}) so a span cannot quietly
     * become an unbounded payload.
     */
    attributes?: Record<string, string | number | boolean>

    /** Which side produced it. */
    env: 'ssr' | 'csr' | 'client' | 'server'

    /** Denormalised from the batch envelope at ingest, like a log row's. */
    resource?: FroggerResource

    session?: { id: string; sampled: boolean }
    user?: string
    route?: string
}

/** Ceiling on a span's own attribute bag. */
export const MAX_SPAN_ATTRIBUTES = 64

/** Ceiling on a single attribute value, in characters. */
export const MAX_SPAN_ATTRIBUTE_CHARS = 1024

/**
 * OTel's status total order: `error` is terminal within a span. A span that
 * failed and then reported success is a span that failed.
 */
export function mergeSpanStatus(current: SpanStatus, next: SpanStatus): SpanStatus {
    if (current.code === 'error') return current
    if (next.code === 'unset') return current
    return next
}

/** Apply the attribute bounds. Over-cap keys are dropped, not truncated away silently. */
export function boundSpanAttributes(
    attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
    if (!attributes) return undefined

    const bounded: Record<string, string | number | boolean> = {}
    let count = 0

    for (const [key, value] of Object.entries(attributes)) {
        if (count >= MAX_SPAN_ATTRIBUTES) break

        if (typeof value === 'string') {
            bounded[key] = value.length > MAX_SPAN_ATTRIBUTE_CHARS
                ? value.slice(0, MAX_SPAN_ATTRIBUTE_CHARS) + '…'
                : value
        }
        else if (typeof value === 'number' || typeof value === 'boolean') {
            bounded[key] = value
        }
        else {
            // Anything else is a payload, not an attribute.
            continue
        }

        count++
    }

    return count > 0 ? bounded : undefined
}
