import { describe, it, expect } from 'vitest'

import { splitMetricBatch } from '../../src/runtime/metrics/shared/utils/split-metric-batch'
import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { MetricObjectBatch } from '../../src/runtime/metrics/shared/types/metric-batch'

function metric(overrides: Partial<MetricObject> = {}): MetricObject {
    return {
        time: 0,
        name: 'web.vital.lcp',
        kind: 'gauge',
        value: 1.2,
        env: 'client',
        ...overrides,
    }
}

function batch(metrics: MetricObject[]): MetricObjectBatch {
    return {
        metrics,
        app: { name: 'app', version: '1' },
        context: { effectiveType: '4g' },
        session: { id: 's1', sampled: true },
        meta: { time: 123 },
    }
}

describe('splitMetricBatch', () => {
    it('returns the input as a single chunk when no caps are set', () => {
        const b = batch([metric(), metric()])
        expect(splitMetricBatch(b)).toEqual([b])
    })

    it('splits by event count', () => {
        const b = batch([metric(), metric(), metric()])
        const chunks = splitMetricBatch(b, { maxEvents: 2 })
        expect(chunks.map(c => c.metrics.length)).toEqual([2, 1])
    })

    it('preserves app / context / session on every chunk and drops meta', () => {
        const b = batch([metric(), metric(), metric()])
        const chunks = splitMetricBatch(b, { maxEvents: 2 })
        for (const chunk of chunks) {
            expect(chunk.app).toEqual({ name: 'app', version: '1' })
            expect(chunk.context).toEqual({ effectiveType: '4g' })
            expect(chunk.session).toEqual({ id: 's1', sampled: true })
            expect(chunk.meta).toBeUndefined()
        }
    })

    it('splits by byte budget', () => {
        const many = Array.from({ length: 50 }, (_, i) => metric({ attr: { id: `id-${i}`, delta: i, navigationType: 'navigate' } }))
        const chunks = splitMetricBatch(batch(many), { maxBytes: 1024 })
        expect(chunks.length).toBeGreaterThan(1)
        expect(chunks.flatMap(c => c.metrics)).toHaveLength(50)
    })

    it('handles an empty batch', () => {
        const b = batch([])
        expect(splitMetricBatch(b, { maxEvents: 10 })).toEqual([b])
    })
})
