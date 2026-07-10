import { describe, it, expect } from 'vitest'
import type { Metric } from 'web-vitals'

import { webVitalToMetric } from '../../src/runtime/metrics/app/collector/web-vitals'

function vital(overrides: Partial<Metric> = {}): Metric {
    return {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 2500,
        id: 'v1-1',
        navigationType: 'navigate',
        entries: [],
        ...overrides,
    } as Metric
}

describe('webVitalToMetric', () => {
    it('maps a timing vital to a gauge in base-unit seconds', () => {
        const m = webVitalToMetric(vital({ name: 'LCP', value: 2500, delta: 2500 }), { time: 1000 })
        expect(m).toMatchObject({
            time: 1000,
            name: 'web.vital.lcp',
            kind: 'gauge',
            value: 2.5,
            unit: 'second',
            env: 'client',
            source: { name: 'web-vitals', version: '5' },
        })
        expect(m.attr).toEqual({ id: 'v1-1', delta: 2.5, navigationType: 'navigate' })
    })

    it('keeps CLS unitless and un-scaled', () => {
        const m = webVitalToMetric(vital({ name: 'CLS', value: 0.12, delta: 0.12 }), {})
        expect(m.name).toBe('web.vital.cls')
        expect(m.unit).toBe('')
        expect(m.value).toBe(0.12)
        expect(m.attr?.delta).toBe(0.12)
    })

    it('puts rating (and route when present) in indexed labels', () => {
        const m = webVitalToMetric(vital({ rating: 'needs-improvement' }), { route: '/users/:id()' })
        expect(m.labels).toEqual({ rating: 'needs-improvement', route: '/users/:id()' })
    })

    it('omits the route label when no route is stamped', () => {
        const m = webVitalToMetric(vital(), {})
        expect(m.labels).toEqual({ rating: 'good' })
    })

    it('stamps the trace exemplar when provided, omits it otherwise', () => {
        const withTrace = webVitalToMetric(vital(), { trace: { traceId: 't1', spanId: 's1' } })
        expect(withTrace.trace).toEqual({ traceId: 't1', spanId: 's1' })

        const withoutTrace = webVitalToMetric(vital(), {})
        expect(withoutTrace.trace).toBeUndefined()
    })

    it('maps all five vitals to their dotted names', () => {
        const names = (['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const).map(
            n => webVitalToMetric(vital({ name: n }), {}).name,
        )
        expect(names).toEqual([
            'web.vital.lcp', 'web.vital.cls', 'web.vital.inp', 'web.vital.fcp', 'web.vital.ttfb',
        ])
    })
})
