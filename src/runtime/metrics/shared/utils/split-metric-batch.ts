import type { MetricObjectBatch } from '../types/metric-batch'

export interface SplitMetricBatchCaps {
    /** Max metric events per chunk. Unset/0 = no count cap. */
    maxEvents?: number
    /** Max serialized body bytes per chunk. Unset/0 = no byte cap. */
    maxBytes?: number
}

/**
 * Split a metric batch into chunks that fit a destination's per-batch caps -
 * the sibling of `splitLoggerBatch`. The load-bearing use in v1 is the
 * page-exit `sendBeacon` path: batches must stay well under the ~64KB beacon
 * quota, so the client caps chunks by byte size before beaconing.
 *
 * Count is applied first, then a greedy byte accumulation over
 * `JSON.stringify(metric).length` against `maxBytes` minus an envelope
 * allowance for the `app`/`context`/`session`/`meta` wrapper. Every chunk keeps
 * the original envelope, `meta` included: the chunks are all the same hop, so
 * they must carry the same schema version, resource block and process chain.
 * When no caps are set the input is returned as a single-element array
 * (zero-copy fast path).
 */
export function splitMetricBatch(
    batch: MetricObjectBatch,
    caps: SplitMetricBatchCaps = {},
): MetricObjectBatch[] {
    const { maxEvents, maxBytes } = caps
    const metrics = batch.metrics

    if (metrics.length === 0) return [batch]
    if (!maxEvents && !maxBytes) return [batch]

    const envelopeBytes = maxBytes
        ? JSON.stringify({
            metrics: [],
            app: batch.app,
            context: batch.context,
            session: batch.session,
            user: batch.user,
            resource: batch.resource,
            meta: batch.meta,
        }).length + 256
        : 0
    const byteBudget = maxBytes ? Math.max(0, maxBytes - envelopeBytes) : 0

    const chunks: MetricObjectBatch[] = []
    let current: typeof metrics = []
    let currentBytes = 0

    const flush = () => {
        if (current.length === 0) return
        chunks.push({
            metrics: current,
            app: batch.app,
            context: batch.context,
            session: batch.session,
            user: batch.user,
            resource: batch.resource,
            meta: batch.meta,
        })
        current = []
        currentBytes = 0
    }

    for (const metric of metrics) {
        const metricBytes = maxBytes ? JSON.stringify(metric).length + 1 : 0

        const overCount = maxEvents ? current.length >= maxEvents : false
        const overBytes = maxBytes && current.length > 0
            ? currentBytes + metricBytes > byteBudget
            : false

        if (overCount || overBytes) {
            flush()
        }

        current.push(metric)
        currentBytes += metricBytes
    }

    flush()

    return chunks
}
