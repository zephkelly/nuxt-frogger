import type { MetricLabels, MetricObject } from '../types/metric'

/**
 * Per-call options for a manually recorded metric. Deliberately narrow: the
 * name and kind are positional because they are the two things that must never
 * vary per call site, and everything optional is bounded.
 */
export interface MetricOptions {
    /**
     * Base unit, OTel/Prometheus convention: `'second'`, `'byte'`, or `''`.
     * `timer()` sets `'second'` for you.
     */
    unit?: string

    /**
     * Indexed dimensions. Every distinct combination is a distinct series on
     * read, so these must be bounded by source code, never by user data: an id,
     * a url or a free-text field here multiplies the series count by its own
     * cardinality. High-cardinality detail goes in {@link attr}.
     */
    labels?: MetricLabels

    /** Non-indexed detail carried for this one event only. */
    attr?: Record<string, string | number | boolean>

    /** Epoch-ms override. For deterministic tests; leave unset in app code. */
    time?: number

    /**
     * Skip trace/session/user/route stamping for a point that must carry no
     * identity at all (an aggregate counter over a whole process, say).
     */
    correlate?: false
}

/**
 * Ambient correlation resolved once per recorded point by the runtime binding.
 * Kept separate from {@link MetricOptions} so {@link buildMetric} stays pure and
 * unit-testable without a Nuxt or Nitro context.
 */
export interface MetricStamp {
    env: MetricObject['env']
    trace?: { traceId: string, spanId?: string }
    session?: { id: string, sampled: boolean }
    user?: string
    route?: string
}

/**
 * The manual metrics API, identical on client and server.
 *
 * ```ts
 * froggerMetrics.counter('checkout.started')
 * froggerMetrics.histogram('db.query.duration', 0.031, { unit: 'second', labels: { op: 'select' } })
 *
 * const stop = froggerMetrics.timer('report.render')
 * await render()
 * stop({ labels: { ok: true } })
 * ```
 */
export interface FroggerMetrics {
    /** A raw delta, never a running total. Defaults to 1. */
    counter: (name: string, value?: number, options?: MetricOptions) => void

    /** A point-in-time reading (queue depth, pool size, peers connected). */
    gauge: (name: string, value: number, options?: MetricOptions) => void

    /** One measurement in a distribution; percentiles are computed on read. */
    histogram: (name: string, value: number, options?: MetricOptions) => void

    /**
     * Start a stopwatch. The returned function records a `second`-unit
     * histogram and returns the elapsed seconds, so a call site can both ship
     * the metric and use the number. Calling it twice records once.
     */
    timer: (name: string, options?: MetricOptions) => (extra?: MetricOptions) => number

    /** Time an async function, recording the histogram on both paths. */
    time: <T>(name: string, fn: () => T | Promise<T>, options?: MetricOptions) => Promise<T>
}
