import type { MetricKind, MetricObject } from '../types/metric'
import type { MetricOptions, MetricStamp } from './types'
import { uuidv7 } from '../../../shared/utils/uuid'
import { checkIdentity } from './registry'

/**
 * Pure metric constructor: no Nuxt, no Nitro, no globals, so the validation and
 * stamping rules are unit-testable in plain Node.
 *
 * Returns `null` rather than throwing for a point that cannot be stored. The
 * reject conditions deliberately mirror what a downstream ingest rejects
 * (non-finite value, empty name, non-positive timestamp), so a doomed point is
 * never queued, never batched and never sent, instead of being dropped
 * silently three hops later.
 */
export function buildMetric(
    name: string,
    kind: MetricKind,
    value: number,
    options: MetricOptions | undefined,
    stamp: MetricStamp,
): MetricObject | null {
    if (typeof name !== 'string' || name.trim() === '') return null
    if (typeof value !== 'number' || !Number.isFinite(value)) return null

    const time = options?.time ?? Date.now()
    if (!Number.isFinite(time) || time <= 0) return null

    // Kind is locked at first use, and label cardinality is bounded. A kind
    // conflict drops the point; an overflow keeps the value and swaps the
    // labels for an overflow marker.
    const identity = checkIdentity(name.trim(), kind, options?.unit, options?.labels)
    if (!identity.ok) return null

    const metric: MetricObject = {
        id: uuidv7(),
        time: Math.trunc(time),
        name: name.trim(),
        kind,
        value,
        env: stamp.env,
    }

    if (options?.unit !== undefined) metric.unit = options.unit
    // Copied, not referenced: a caller mutating its own object afterwards used
    // to mutate a point already sitting in a 15s batch window.
    if (identity.labels) metric.labels = { ...identity.labels }
    else if (options?.labels) metric.labels = { ...options.labels }
    if (options?.attr) metric.attr = { ...options.attr }

    // `correlate: false` is the opt-out for a point that must carry no identity.
    if (options?.correlate === false) return metric

    // An explicit per-call exemplar wins over the ambient one.
    const trace = options?.trace ?? stamp.trace
    if (trace) metric.trace = trace
    if (stamp.session) metric.session = stamp.session
    if (stamp.user) metric.user = stamp.user

    // Route is a bounded pattern, so it rides labels where it can be grouped on,
    // and an explicit per-call label always wins over the ambient reading.
    if (stamp.route && metric.labels?.route === undefined) {
        metric.labels = { ...metric.labels, route: stamp.route }
    }

    return metric
}
