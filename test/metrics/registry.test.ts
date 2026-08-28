import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { buildMetric } from '../../src/runtime/metrics/shared/api/build-metric'
import { resetMetricRegistry, checkIdentity, DEFAULT_CARDINALITY_LIMIT } from '../../src/runtime/metrics/shared/api/registry'
import { resetOnceEmitted } from '../../src/runtime/shared/utils/internal-log'
import type { MetricStamp } from '../../src/runtime/metrics/shared/api/types'

const stamp: MetricStamp = { env: 'server' }

beforeEach(() => {
    resetMetricRegistry()
    resetOnceEmitted()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('metric kind lock', () => {
    it('drops a point whose kind contradicts the first use of that name', () => {
        // A counter and a gauge merged into one series corrupts both, and no
        // reading of the stored data recovers them.
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(buildMetric('app.thing', 'counter', 1, undefined, stamp)).not.toBeNull()
        expect(buildMetric('app.thing', 'gauge', 1, undefined, stamp)).toBeNull()
    })

    it('warns once per conflicting name, not once per point', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        buildMetric('app.thing', 'counter', 1, undefined, stamp)
        buildMetric('app.thing', 'gauge', 1, undefined, stamp)
        buildMetric('app.thing', 'gauge', 1, undefined, stamp)
        buildMetric('app.thing', 'gauge', 1, undefined, stamp)

        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('keeps distinct names independent', () => {
        expect(buildMetric('a.count', 'counter', 1, undefined, stamp)).not.toBeNull()
        expect(buildMetric('b.level', 'gauge', 1, undefined, stamp)).not.toBeNull()
    })
})

describe('metric unit handling', () => {
    it('records an unknown unit rather than narrowing to a closed union', () => {
        // A domain unit frogger has not heard of is still a valid unit.
        const m = buildMetric('app.thing', 'gauge', 1, { unit: 'furlong' }, stamp)
        expect(m!.unit).toBe('furlong')
    })
})

describe('metric cardinality overflow', () => {
    it('keeps the value and replaces the labels once the budget is spent', () => {
        // OTel's algorithm: never silently drop the measurement, which is the
        // failure mode the overflow bucket exists to avoid.
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        for (let i = 0; i < DEFAULT_CARDINALITY_LIMIT; i++) {
            buildMetric('app.hot', 'counter', 1, { labels: { id: `v${i}` } }, stamp)
        }

        const overflowed = buildMetric('app.hot', 'counter', 7, { labels: { id: 'one-too-many' } }, stamp)

        expect(overflowed).not.toBeNull()
        expect(overflowed!.value).toBe(7)
        expect(overflowed!.labels).toEqual({ overflow: true })
    })

    it('does not count a repeated label combination against the budget', () => {
        for (let i = 0; i < DEFAULT_CARDINALITY_LIMIT * 2; i++) {
            buildMetric('app.steady', 'counter', 1, { labels: { op: 'select' } }, stamp)
        }

        const m = buildMetric('app.steady', 'counter', 1, { labels: { op: 'select' } }, stamp)
        expect(m!.labels).toEqual({ op: 'select' })
    })

    it('treats label order as irrelevant when fingerprinting', () => {
        const first = checkIdentity('app.pair', 'counter', undefined, { a: '1', b: '2' }, 2)
        const reordered = checkIdentity('app.pair', 'counter', undefined, { b: '2', a: '1' }, 2)

        expect(first.labels).toBeUndefined()
        expect(reordered.labels).toBeUndefined()
    })

    it('warns once when a name overflows', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        for (let i = 0; i < 5; i++) {
            checkIdentity('app.hot', 'counter', undefined, { id: `v${i}` }, 2)
        }

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]!.join(' ')).toContain('distinct label combinations')
    })
})

describe('point isolation', () => {
    it('copies labels and attr so a later caller mutation cannot rewrite a queued point', () => {
        // The point may sit in a 15s batch window; the caller owns its object.
        const labels = { op: 'select' }
        const attr = { statement: 'x' }

        const m = buildMetric('app.thing', 'counter', 1, { labels, attr }, stamp)!

        labels.op = 'mutated'
        attr.statement = 'mutated'

        expect(m.labels).toEqual({ op: 'select' })
        expect(m.attr).toEqual({ statement: 'x' })
    })
})
