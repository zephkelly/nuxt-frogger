/**
 * The metrics subsystem's raw event type. Deliberately shares ZERO types with
 * the logging pipeline's {@link LoggerObject}: a metric is a trace-linked
 * measurement, never a log with a numeric field.
 *
 * The whole subsystem stores raw, per-event deltas and aggregates on read
 * (percentiles/bucketing are computed by whatever consumes the JSON-lines
 * file or the downstream store) — nothing here is ever pre-aggregated into a
 * series at ingest, which is the cardinality/`metric→trace`-severing footgun
 * that killed Sentry's pre-aggregated custom metrics.
 */

/** Locked at definition — never inferred, never changed after the fact. */
export type MetricKind = 'counter' | 'gauge' | 'histogram'

/**
 * Indexed dimensions only: low-cardinality values safe to build a series index
 * on (a web-vital `rating`, a route *pattern*). NEVER ids, urls or free-form
 * user input — those belong in {@link MetricObject.attr}.
 */
export type MetricLabels = Record<string, string | number | boolean>

export interface MetricObject {
    /** Epoch milliseconds the measurement was taken. */
    time: number

    /** Dot-namespaced metric name, e.g. `web.vital.lcp`. */
    name: string

    /** The metric kind, locked at the point the metric is defined. */
    kind: MetricKind

    /** The measured value (a raw delta for histograms, never a running sum). */
    value: number

    /**
     * Base unit, following the OTel/Prometheus base-unit convention:
     * `'second'`, `'byte'`, or `''` (unitless, e.g. CLS).
     */
    unit?: string

    /**
     * Indexed dimensions ONLY (rating, route pattern). Every distinct label
     * combination is a distinct series on read, so this stays bounded and
     * low-cardinality by construction — ids/urls/deltas go in {@link attr}.
     */
    labels?: MetricLabels

    /** Which side, and which phase, produced the measurement. */
    env: 'ssr' | 'csr' | 'client' | 'server'

    /** Producer of the metric (library name + version). */
    source?: { name: string; version: string }

    /**
     * Exemplar pointer to the trace this measurement belongs to — a pointer,
     * not a log. The referenced trace's logs may not exist (a sampled-out
     * session still emits metrics), so consumers must treat this as a
     * best-effort link, never a foreign key.
     */
    trace?: { traceId: string; spanId?: string }

    /**
     * Non-indexed detail: high-cardinality fields carried for a single event
     * but never indexed into a series (the web-vital instance `id`, the raw
     * `delta`, `navigationType`).
     */
    attr?: Record<string, string | number | boolean>
}
