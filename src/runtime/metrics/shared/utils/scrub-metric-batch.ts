import type { LogScrubber } from '../../../scrubber'
import type { MetricObjectBatch } from '../types/metric-batch'

/**
 * Redact a metric batch with the log pipeline's own ruleset.
 *
 * `labels` and `attr` are free-form bags written by application code, and they
 * reach a downstream store as raw JSON. Without this hop the scrubber, which is
 * the only redaction control in the system, never sees a metric at all, so the
 * first business metric anyone writes (a habit title, an answer, a search term)
 * ships unredacted while the identical field in a log's `ctx` is caught.
 *
 * `name` is deliberately untouched: it is the indexed series identifier and is
 * a compile-time constant at every sane call site, so rewriting it would break
 * the series rather than protect anything. `user` and `session` are correlation
 * ids by design, the same disposition the log pipeline gives `ctx.user`.
 *
 * Mutation is confined to the batch's own points: the scrubber copies on write,
 * so a caller's `labels` object passed by reference is never modified.
 */
export function scrubMetricBatch(batch: MetricObjectBatch, scrubber: LogScrubber): void {
    for (const metric of batch.metrics ?? []) {
        if (metric.labels) {
            const scrubbed = scrubber.scrubRecord(metric.labels)
            if (scrubbed.modified) metric.labels = scrubbed.value
        }

        if (metric.attr) {
            const scrubbed = scrubber.scrubRecord(metric.attr)
            if (scrubbed.modified) metric.attr = scrubbed.value
        }
    }

    if (batch.context) {
        const scrubbed = scrubber.scrubRecord(batch.context)
        if (scrubbed.modified) batch.context = scrubbed.value
    }
}
