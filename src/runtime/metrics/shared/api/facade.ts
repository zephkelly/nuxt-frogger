import type { MetricObject } from '../types/metric'
import type { FroggerMetrics, MetricOptions, MetricStamp } from './types'

import { buildMetric } from './build-metric'
import { monotonicNow, elapsedSeconds } from '../../../shared/utils/now'
import { froggerInternal } from '../../../shared/utils/internal-log'

/**
 * Build the manual metrics API over a runtime's own record sink and ambient
 * stamp resolver. Both are called per point, never at import time, so a facade
 * can be constructed at module scope without touching a Nuxt app or an H3
 * event that does not exist yet.
 *
 * Every path is failure-swallowing on purpose: recording a measurement must
 * never be able to break the code being measured.
 */
export function createMetricsFacade(
    record: (metric: MetricObject) => void,
    resolveStamp: () => MetricStamp,
): FroggerMetrics {
    function emit(name: string, kind: MetricObject['kind'], value: number, options?: MetricOptions): void {
        try {
            const metric = buildMetric(name, kind, value, options, resolveStamp())
            if (metric) record(metric)
        }
        catch (err) {
            froggerInternal.error('Failed to record metric', name, err)
        }
    }

    function timer(name: string, options?: MetricOptions) {
        const start = monotonicNow()
        let stopped = false

        return (extra?: MetricOptions): number => {
            const seconds = elapsedSeconds(start)
            if (stopped) return seconds
            stopped = true

            emit(name, 'histogram', seconds, {
                ...options,
                ...extra,
                unit: extra?.unit ?? options?.unit ?? 'second',
                labels: { ...options?.labels, ...extra?.labels },
                attr: { ...options?.attr, ...extra?.attr },
            })
            return seconds
        }
    }

    return {
        counter: (name, value = 1, options) => emit(name, 'counter', value, options),
        gauge: (name, value, options) => emit(name, 'gauge', value, options),
        histogram: (name, value, options) => emit(name, 'histogram', value, options),
        timer,

        async time(name, fn, options) {
            const stop = timer(name, options)
            try {
                const result = await fn()
                stop({ labels: { ok: true } })
                return result
            }
            catch (error) {
                stop({ labels: { ok: false } })
                throw error
            }
        },
    }
}

/** A facade that records nothing, for a runtime where metrics are unavailable. */
export function createNoopMetricsFacade(): FroggerMetrics {
    const noop = () => {}
    return {
        counter: noop,
        gauge: noop,
        histogram: noop,
        timer: () => () => 0,
        time: async (_name, fn) => fn(),
    }
}
