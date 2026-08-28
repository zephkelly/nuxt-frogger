/**
 * Structurally identical to the metrics subsystem's `MetricLabels`, declared
 * here rather than imported so the logger tree never references the metrics
 * tree, even in a type position.
 */
export type SpanMetricLabels = Record<string, string | number | boolean>

/**
 * Exemplar pointing at the span being measured. Declared here for the same
 * reason as {@link SpanMetricLabels}: the logger tree must not reference the
 * metrics tree even in a type position.
 */
export interface SpanExemplar {
    traceId: string
    spanId?: string
    flags?: string
}

/**
 * Receives one span's duration in seconds. Registered by the metrics subsystem
 * at plugin init, read by the logger classes when a span ends.
 *
 * This indirection is the whole point: the logger tree must not import the
 * metrics tree (they deliberately share no types and no state), and the metrics
 * subsystem is opt-in, so a bare install must not pull it into either bundle.
 * A null sink is the normal state, not an error.
 *
 * `trace` is the span's OWN exemplar, passed explicitly rather than resolved
 * from ambient state: the sink fires after the span's context scope has
 * already exited, so an ambient lookup returns the ENCLOSING span - which made
 * every nested span's latency land on its parent.
 */
export type SpanMetricSink = (
    name: string,
    durationSeconds: number,
    ok: boolean,
    labels?: SpanMetricLabels,
    trace?: SpanExemplar,
) => void

let sink: SpanMetricSink | null = null

export function setSpanMetricSink(fn: SpanMetricSink | null): void {
    sink = fn
}

export function getSpanMetricSink(): SpanMetricSink | null {
    return sink
}
