import { froggerInternal } from '../../../shared/utils/internal-log'
import type { MetricKind, MetricLabels } from '../types/metric'

/**
 * Process-local metric identity and cardinality guards.
 *
 * `buildMetric` validated only that a name was non-empty and a value finite, so
 * `counter('x')` and `gauge('x')` produced one mixed series that contradicts
 * the docstring on `MetricKind` ("locked at definition"), and nothing bounded
 * how many distinct label combinations one name could mint.
 */

export interface MetricIdentity {
    kind: MetricKind
    unit: string
}

/** Distinct label combinations one metric name may have before overflowing. */
export const DEFAULT_CARDINALITY_LIMIT = 200

/** Units frogger recognises. Unknown ones are recorded, with one warning. */
const KNOWN_UNITS = new Set(['', 'second', 'byte', 'millisecond', 'request', 'operation', 'error'])

interface RegistryState {
    identities: Map<string, MetricIdentity>
    fingerprints: Map<string, Set<string>>
    overflowed: Set<string>
    warnedUnits: Set<string>
}

const STATE: RegistryState = (
    (globalThis as unknown as { __FROGGER_METRIC_REGISTRY__?: RegistryState }).__FROGGER_METRIC_REGISTRY__ ??= {
        identities: new Map(),
        fingerprints: new Map(),
        overflowed: new Set(),
        warnedUnits: new Set(),
    }
)

export interface IdentityCheck {
    /** `false` when the point contradicts an established identity and is dropped. */
    ok: boolean
    /** Replacement labels when the name has overflowed its cardinality budget. */
    labels?: MetricLabels
}

/**
 * Lock a metric name to the first `kind` it was recorded with, and bound how
 * many label combinations it may mint.
 *
 * A kind conflict DROPS the conflicting point: merging a counter and a gauge
 * into one series corrupts both, and there is no reading of the data that
 * recovers them.
 *
 * A cardinality overflow does NOT drop the point. It keeps the measurement and
 * replaces the labels with an overflow marker - OTel's algorithm, and the right
 * trade: a total that is still correct beats a missing total.
 */
export function checkIdentity(
    name: string,
    kind: MetricKind,
    unit: string | undefined,
    labels: MetricLabels | undefined,
    limit: number = DEFAULT_CARDINALITY_LIMIT,
): IdentityCheck {
    const established = STATE.identities.get(name)

    if (!established) {
        STATE.identities.set(name, { kind, unit: unit ?? '' })
    }
    else if (established.kind !== kind) {
        froggerInternal.always.onceWarn(
            `metric-kind-conflict:${name}`,
            `Metric "${name}" was first recorded as a ${established.kind} and is now being recorded `
            + `as a ${kind}. The kind is locked at first use; this point is dropped rather than `
            + `corrupting the series. Rename one of the two call sites.`,
        )
        return { ok: false }
    }

    if (unit !== undefined && !KNOWN_UNITS.has(unit) && !STATE.warnedUnits.has(unit)) {
        STATE.warnedUnits.add(unit)
        // Warn, but record: `unit` is deliberately not a closed union, because
        // a domain unit frogger has not heard of is still a valid unit.
        froggerInternal.warn(
            `Metric unit "${unit}" is not one of the conventional base units `
            + `(${[...KNOWN_UNITS].filter(Boolean).join(', ')}). Recording it anyway.`,
        )
    }

    return checkCardinality(name, labels, limit)
}

function checkCardinality(
    name: string,
    labels: MetricLabels | undefined,
    limit: number,
): IdentityCheck {
    if (STATE.overflowed.has(name)) {
        return { ok: true, labels: { overflow: true } }
    }

    const fingerprint = fingerprintLabels(labels)
    let seen = STATE.fingerprints.get(name)

    if (!seen) {
        seen = new Set()
        STATE.fingerprints.set(name, seen)
    }

    if (seen.has(fingerprint)) return { ok: true }

    if (seen.size >= limit) {
        STATE.overflowed.add(name)
        // Free the fingerprint set: past the limit it is only memory.
        STATE.fingerprints.delete(name)

        froggerInternal.always.onceWarn(
            `metric-cardinality:${name}`,
            `Metric "${name}" exceeded ${limit} distinct label combinations. Further points keep `
            + `their VALUE but their labels are replaced with an overflow marker. A label here is `
            + `almost certainly carrying an id, a url or free-form user input - those belong in `
            + `attr, which is not indexed.`,
        )

        return { ok: true, labels: { overflow: true } }
    }

    seen.add(fingerprint)
    return { ok: true }
}

/** Order-independent key for one label combination. */
function fingerprintLabels(labels: MetricLabels | undefined): string {
    if (!labels) return ''

    return Object.keys(labels)
        .sort()
        .map(key => `${key}=${String(labels[key])}`)
        .join('')
}

/** Test seam: forget every locked identity and cardinality budget. */
export function resetMetricRegistry(): void {
    STATE.identities.clear()
    STATE.fingerprints.clear()
    STATE.overflowed.clear()
    STATE.warnedUnits.clear()
}
