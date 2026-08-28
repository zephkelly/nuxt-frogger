import { describe, it, expect } from 'vitest'

import { LogScrubber } from '../../src/runtime/scrubber'
import { scrubMetricBatch } from '../../src/runtime/metrics/shared/utils/scrub-metric-batch'
import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { MetricObjectBatch } from '../../src/runtime/metrics/shared/types/metric-batch'

function scrubber() {
    return new LogScrubber({
        enabled: true,
        rules: [
            { action: 'redact', fieldPatterns: ['email'], priority: 100, description: 'email' },
            { action: 'redact', fieldPatterns: ['title'], priority: 90, description: 'title' },
        ],
    })
}

function metric(overrides: Partial<MetricObject> = {}): MetricObject {
    return { time: 1000, name: 'app.thing', kind: 'counter', value: 1, env: 'server', ...overrides }
}

function batch(metrics: MetricObject[], rest: Partial<MetricObjectBatch> = {}): MetricObjectBatch {
    return { metrics, ...rest }
}

describe('scrubMetricBatch', () => {
    it('redacts a matching label', () => {
        const b = batch([metric({ labels: { title: 'Morning walk', op: 'complete' } })])
        scrubMetricBatch(b, scrubber())

        expect(b.metrics[0]!.labels!.title).not.toBe('Morning walk')
        expect(b.metrics[0]!.labels!.op).toBe('complete')
    })

    it('redacts a matching attribute', () => {
        const b = batch([metric({ attr: { email: 'a@b.com', id: 'abc' } })])
        scrubMetricBatch(b, scrubber())

        expect(b.metrics[0]!.attr!.email).not.toBe('a@b.com')
        expect(b.metrics[0]!.attr!.id).toBe('abc')
    })

    it('redacts the batch device context', () => {
        const b = batch([metric()], { context: { email: 'a@b.com' } as never })
        scrubMetricBatch(b, scrubber())

        expect((b.context as Record<string, unknown>).email).not.toBe('a@b.com')
    })

    it('leaves the metric name untouched, since it is the series identifier', () => {
        const b = batch([metric({ name: 'user.email.sent' })])
        scrubMetricBatch(b, scrubber())

        expect(b.metrics[0]!.name).toBe('user.email.sent')
    })

    it('leaves correlation ids untouched, matching the log pipeline', () => {
        const b = batch([metric({ user: 'user-public-1', session: { id: 'sess-1', sampled: true } })])
        scrubMetricBatch(b, scrubber())

        expect(b.metrics[0]!.user).toBe('user-public-1')
        expect(b.metrics[0]!.session).toEqual({ id: 'sess-1', sampled: true })
    })

    it('never mutates a labels object the caller still holds', () => {
        const callerLabels = { title: 'Morning walk' }
        const b = batch([metric({ labels: callerLabels })])
        scrubMetricBatch(b, scrubber())

        expect(callerLabels.title).toBe('Morning walk')
        expect(b.metrics[0]!.labels!.title).not.toBe('Morning walk')
    })

    it('handles a batch with no labels, attr or context', () => {
        const b = batch([metric()])

        expect(() => scrubMetricBatch(b, scrubber())).not.toThrow()
        expect(b.metrics[0]!.labels).toBeUndefined()
    })

    it('scrubs every point in the batch, not just the first', () => {
        const b = batch([
            metric({ labels: { title: 'one' } }),
            metric({ labels: { title: 'two' } }),
        ])
        scrubMetricBatch(b, scrubber())

        expect(b.metrics[0]!.labels!.title).not.toBe('one')
        expect(b.metrics[1]!.labels!.title).not.toBe('two')
    })
})
