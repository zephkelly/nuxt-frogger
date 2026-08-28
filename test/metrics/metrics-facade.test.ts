import { describe, it, expect, vi } from 'vitest'

import { createMetricsFacade, createNoopMetricsFacade } from '../../src/runtime/metrics/shared/api/facade'
import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { MetricStamp } from '../../src/runtime/metrics/shared/api/types'

function harness(stamp: MetricStamp = { env: 'server' }) {
    const recorded: MetricObject[] = []
    const metrics = createMetricsFacade(m => recorded.push(m), () => stamp)
    return { recorded, metrics }
}

describe('createMetricsFacade', () => {
    it('counter defaults to a delta of 1', () => {
        const { recorded, metrics } = harness()
        metrics.counter('checkout.started')

        expect(recorded).toHaveLength(1)
        expect(recorded[0]).toMatchObject({ name: 'checkout.started', kind: 'counter', value: 1 })
    })

    it('counter takes an explicit delta', () => {
        const { recorded, metrics } = harness()
        metrics.counter('rows.written', 42)

        expect(recorded[0]!.value).toBe(42)
    })

    it('gauge and histogram record their kind', () => {
        const { recorded, metrics } = harness()
        metrics.gauge('queue.depth', 7)
        metrics.histogram('db.query.duration', 0.031, { unit: 'second' })

        expect(recorded[0]).toMatchObject({ kind: 'gauge', value: 7 })
        expect(recorded[1]).toMatchObject({ kind: 'histogram', value: 0.031, unit: 'second' })
    })

    it('does not record a point that could not be stored', () => {
        const { recorded, metrics } = harness()
        metrics.gauge('app.thing', Number.NaN)
        metrics.counter('')

        expect(recorded).toHaveLength(0)
    })

    describe('timer', () => {
        it('records a second-unit histogram and returns the elapsed seconds', () => {
            const { recorded, metrics } = harness()
            const stop = metrics.timer('report.render')
            const elapsed = stop()

            expect(recorded).toHaveLength(1)
            expect(recorded[0]).toMatchObject({ name: 'report.render', kind: 'histogram', unit: 'second' })
            expect(elapsed).toBeGreaterThanOrEqual(0)
            expect(recorded[0]!.value).toBe(elapsed)
        })

        it('records once even when stopped twice', () => {
            const { recorded, metrics } = harness()
            const stop = metrics.timer('report.render')
            stop()
            stop()

            expect(recorded).toHaveLength(1)
        })

        it('merges labels from creation and from stop', () => {
            const { recorded, metrics } = harness()
            const stop = metrics.timer('report.render', { labels: { kind: 'pdf' } })
            stop({ labels: { ok: true } })

            expect(recorded[0]!.labels).toMatchObject({ kind: 'pdf', ok: true })
        })
    })

    describe('time', () => {
        it('records ok: true and returns the resolved value', async () => {
            const { recorded, metrics } = harness()
            const result = await metrics.time('work', async () => 'done')

            expect(result).toBe('done')
            expect(recorded[0]!.labels).toMatchObject({ ok: true })
        })

        it('records ok: false and rethrows', async () => {
            const { recorded, metrics } = harness()
            const boom = new Error('boom')

            await expect(metrics.time('work', async () => { throw boom })).rejects.toBe(boom)
            expect(recorded).toHaveLength(1)
            expect(recorded[0]!.labels).toMatchObject({ ok: false })
        })
    })

    it('a throwing stamp resolver never breaks the caller', () => {
        const recorded: MetricObject[] = []
        const metrics = createMetricsFacade(
            m => recorded.push(m),
            () => { throw new Error('no context') },
        )

        expect(() => metrics.counter('app.thing')).not.toThrow()
        expect(recorded).toHaveLength(0)
    })

    it('a throwing sink never breaks the caller', () => {
        const metrics = createMetricsFacade(
            () => { throw new Error('queue exploded') },
            () => ({ env: 'server' }),
        )

        expect(() => metrics.counter('app.thing')).not.toThrow()
    })

    it('resolves the stamp per point, not once at construction', () => {
        const resolveStamp = vi.fn(() => ({ env: 'server' as const }))
        const metrics = createMetricsFacade(() => {}, resolveStamp)

        metrics.counter('a')
        metrics.counter('b')

        expect(resolveStamp).toHaveBeenCalledTimes(2)
    })
})

describe('createNoopMetricsFacade', () => {
    it('records nothing and still returns usable values', async () => {
        const metrics = createNoopMetricsFacade()

        expect(() => metrics.counter('a')).not.toThrow()
        expect(metrics.timer('a')()).toBe(0)
        await expect(metrics.time('a', async () => 'v')).resolves.toBe('v')
    })
})
