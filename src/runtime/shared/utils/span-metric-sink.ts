/**
 * Structurally identical to the metrics subsystem's `MetricLabels`, declared
 * here rather than imported so the logger tree never references the metrics
 * tree, even in a type position.
 */
export type SpanMetricLabels = Record<string, string | number | boolean>

/**
 * Receives one span's duration in seconds. Registered by the metrics subsystem
 * at plugin init, read by the logger classes when a span ends.
 *
 * This indirection is the whole point: the logger tree must not import the
 * metrics tree (they deliberately share no types and no state), and the metrics
 * subsystem is opt-in, so a bare install must not pull it into either bundle.
 * A null sink is the normal state, not an error.
 */
export type SpanMetricSink = (
    name: string,
    durationSeconds: number,
    ok: boolean,
    labels?: SpanMetricLabels,
) => void

let sink: SpanMetricSink | null = null

export function setSpanMetricSink(fn: SpanMetricSink | null): void {
    sink = fn
}

export function getSpanMetricSink(): SpanMetricSink | null {
    return sink
}
