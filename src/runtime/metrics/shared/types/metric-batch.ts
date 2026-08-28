import type { MetricObject } from './metric'

/**
 * Device / network / viewport envelope, collected and transmitted ONCE per
 * batch, then denormalised onto each stored event at server ingest (transports
 * receive a bare `MetricObject[]`, so the envelope only survives on the
 * points). The cardinality guardrail is that it stays out of the per-point
 * `labels`: a device string as a label would multiply every series by the
 * number of distinct devices.
 *
 * Every field is best-effort and feature-detected on the client; an
 * unsupported API is `null` (never `0`, which would read as a real reading).
 */
export interface MetricContext {
    /** Raw User-Agent request header, stamped server-side at ingest. */
    ua?: string

    /** Parsed client hints from `navigator.userAgentData`, best-effort. */
    browser?: string
    os?: string
    deviceType?: string

    /** `navigator.connection.effectiveType` - `null` when unsupported. */
    effectiveType?: string | null
    /** `navigator.deviceMemory` (GiB) - `null` when unsupported. */
    deviceMemory?: number | null
    /** `navigator.hardwareConcurrency` - `null` when unsupported. */
    hardwareConcurrency?: number | null

    /** Viewport size in CSS pixels at collection time. */
    viewport?: { w: number; h: number }
}

/**
 * The wire shape POSTed to the metrics ingest route. Structurally parallel to
 * {@link LoggerObjectBatch} but shares no types with it: the two pipelines are
 * fully independent.
 */
export interface MetricObjectBatch {
    metrics: MetricObject[]
    app?: { name?: string; version?: string }

    /** Device envelope - rides the batch once; denormalised onto points at ingest. */
    context?: MetricContext

    /** One sampling decision per session (uuidv7 session id). */
    session?: { id: string; sampled: boolean }

    /** Acting user, denormalised onto points at ingest like {@link context}. */
    user?: string

    /** Same loop-detection convention as the log pipeline. */
    meta?: {
        processed?: true
        processChain?: string[]
        source?: string
        time?: number
    }
}
