import type { Metric } from 'web-vitals'

import type { MetricObject } from '../../shared/types/metric'

/**
 * Web Vitals collector. `web-vitals` touches browser globals at import, so the
 * library itself is loaded via a dynamic `import()` inside {@link registerWebVitals}
 * (only ever invoked from the client plugin) — the module top level imports the
 * `Metric` *type* only, which is erased, so {@link webVitalToMetric} stays a
 * pure, unit-testable mapping importable from a plain Node context.
 */

/** Extra context stamped onto each vital: the page/active trace + route pattern. */
export interface WebVitalStamp {
    trace?: { traceId: string; spanId?: string }
    route?: string
    /** Overridable for deterministic tests; defaults to `Date.now()`. */
    time?: number
}

interface VitalSpec {
    name: string
    unit: string
    /** Convert the library value (ms for timings, unitless for CLS) to base units. */
    toBase: (v: number) => number
}

const MS_TO_SECONDS = (v: number) => v / 1000

// Web Vitals map to gauges. Timing vitals arrive in milliseconds and are
// converted to seconds (OTel/Prometheus base-unit convention); CLS is unitless.
const VITAL_SPECS: Record<Metric['name'], VitalSpec> = {
    LCP: { name: 'web.vital.lcp', unit: 'second', toBase: MS_TO_SECONDS },
    CLS: { name: 'web.vital.cls', unit: '', toBase: v => v },
    INP: { name: 'web.vital.inp', unit: 'second', toBase: MS_TO_SECONDS },
    FCP: { name: 'web.vital.fcp', unit: 'second', toBase: MS_TO_SECONDS },
    TTFB: { name: 'web.vital.ttfb', unit: 'second', toBase: MS_TO_SECONDS },
}

const SOURCE = { name: 'web-vitals', version: '5' }

/**
 * Convert a `web-vitals` `Metric` into a Frogger {@link MetricObject}. `rating`
 * and the route *pattern* are indexed labels; the high-cardinality instance
 * `id`, raw `delta` and `navigationType` go in non-indexed `attr`.
 */
export function webVitalToMetric(metric: Metric, stamp: WebVitalStamp = {}): MetricObject {
    const spec = VITAL_SPECS[metric.name]

    const labels: MetricObject['labels'] = { rating: metric.rating }
    if (stamp.route) {
        labels.route = stamp.route
    }

    return {
        time: stamp.time ?? Date.now(),
        name: spec.name,
        kind: 'gauge',
        value: spec.toBase(metric.value),
        unit: spec.unit,
        labels,
        env: 'client',
        source: SOURCE,
        ...(stamp.trace ? { trace: stamp.trace } : {}),
        attr: {
            id: metric.id,
            delta: spec.toBase(metric.delta),
            navigationType: metric.navigationType,
        },
    }
}

export interface WebVitalsCollectorOptions {
    reportAllChanges?: boolean
}

/**
 * Wire the five web-vitals reporters, converting each callback to a
 * {@link MetricObject} via {@link webVitalToMetric} and handing it to `onMetric`.
 * `resolveStamp` is called at report time so the trace exemplar can pick up an
 * active span if one happens to be open (opportunistic) while the route pattern
 * stays fixed to the page's landing route.
 *
 * Final-value-only by default; the library de-dupes bfcache restores itself, so
 * there is no `pageshow` re-invocation here.
 */
export async function registerWebVitals(
    options: WebVitalsCollectorOptions,
    onMetric: (metric: MetricObject) => void,
    resolveStamp: () => WebVitalStamp,
): Promise<void> {
    const { onLCP, onCLS, onINP, onFCP, onTTFB } = await import('web-vitals')

    const opts = { reportAllChanges: options.reportAllChanges ?? false }
    const handler = (metric: Metric) => {
        try {
            onMetric(webVitalToMetric(metric, resolveStamp()))
        }
        catch {
            // A single bad vital must never break the others.
        }
    }

    onLCP(handler, opts)
    onCLS(handler, opts)
    onINP(handler, opts)
    onFCP(handler, opts)
    onTTFB(handler, opts)
}
