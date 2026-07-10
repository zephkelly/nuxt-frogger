import { describe, it, expect } from 'vitest'

import {
    resolveMetricsOptions,
    DEFAULT_METRICS_BATCH,
    DEFAULT_METRICS_PUBLIC_BATCH,
    DEFAULT_METRICS_ENDPOINT,
    DEFAULT_METRICS_FILE,
    DEFAULT_MAX_EVENTS_PER_PAGE,
} from '../../src/runtime/metrics/shared/utils/resolve-metrics'
import { resolveFroggerOptions } from '../../src/runtime/shared/utils/resolve-options'
import {
    metricFileTransport,
    metricMemoryTransport,
} from '../../src/runtime/metrics/shared/transports/factories'

describe('resolveMetricsOptions', () => {
    describe('off by default', () => {
        it('false / undefined resolve to false', () => {
            expect(resolveMetricsOptions(false)).toBe(false)
            expect(resolveMetricsOptions(undefined)).toBe(false)
        })

        it('is NOT enabled by any preset (independent of preset)', () => {
            expect(resolveFroggerOptions({ preset: 'full' }).metrics).toBe(false)
            expect(resolveFroggerOptions({ preset: 'standard' }).metrics).toBe(false)
            expect(resolveFroggerOptions().metrics).toBe(false)
        })
    })

    describe('metrics: true (defaults)', () => {
        const r = resolveMetricsOptions(true)
        if (r === false) throw new Error('expected resolved metrics')

        it('turns on web vitals + device stats', () => {
            expect(r.webVitals).toEqual({ reportAllChanges: false })
            expect(r.deviceStats).toBe(true)
        })

        it('defaults sampleRate 1 and maxEventsPerPage 500', () => {
            expect(r.sampleRate).toBe(1)
            expect(r.maxEventsPerPage).toBe(DEFAULT_MAX_EVENTS_PER_PAGE)
        })

        it('uses distinct server and client batch defaults', () => {
            expect(r.batch).toEqual(DEFAULT_METRICS_BATCH)
            expect(r.public.batch).toEqual(DEFAULT_METRICS_PUBLIC_BATCH)
            expect((r.batch as { maxAge: number }).maxAge)
                .not.toEqual((r.public.batch as { maxAge: number }).maxAge)
        })

        it('resolves the default metrics endpoint', () => {
            expect(r.public.endpoint).toBe(DEFAULT_METRICS_ENDPOINT)
        })

        it('has no transports by default', () => {
            expect(r.transports).toEqual({ server: [], client: [] })
        })
    })

    describe('partial object precedence', () => {
        it('respects explicit webVitals: false while keeping deviceStats', () => {
            const r = resolveMetricsOptions({ webVitals: false })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.webVitals).toBe(false)
            expect(r.deviceStats).toBe(true)
        })

        it('respects deviceStats: false', () => {
            const r = resolveMetricsOptions({ deviceStats: false })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.deviceStats).toBe(false)
        })

        it('carries reportAllChanges through', () => {
            const r = resolveMetricsOptions({ webVitals: { reportAllChanges: true } })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.webVitals).toEqual({ reportAllChanges: true })
        })

        it('clamps sampleRate into [0, 1]', () => {
            expect((resolveMetricsOptions({ sampleRate: 2 }) as any).sampleRate).toBe(1)
            expect((resolveMetricsOptions({ sampleRate: -1 }) as any).sampleRate).toBe(0)
            expect((resolveMetricsOptions({ sampleRate: 0.25 }) as any).sampleRate).toBe(0.25)
        })

        it('honours batch: false on both sides independently', () => {
            const r = resolveMetricsOptions({ batch: false, public: { batch: false } })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.batch).toBe(false)
            expect(r.public.batch).toBe(false)
        })

        it('honours public.endpoint: false', () => {
            const r = resolveMetricsOptions({ public: { endpoint: false } })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.public.endpoint).toBe(false)
        })
    })

    describe('transport split', () => {
        it('routes file + memory entries to the server list, client stays empty', () => {
            const r = resolveMetricsOptions({
                transports: [metricFileTransport(), metricMemoryTransport({ name: 'cap' })],
            })
            if (r === false) throw new Error('expected resolved metrics')
            expect(r.transports.client).toEqual([])
            expect(r.transports.server).toEqual([
                { type: 'file', name: 'file', options: DEFAULT_METRICS_FILE },
                { type: 'memory', name: 'cap' },
            ])
        })

        it('defaults the metrics file directory to logs/metrics', () => {
            const r = resolveMetricsOptions({ transports: [metricFileTransport()] })
            if (r === false) throw new Error('expected resolved metrics')
            const file = r.transports.server[0] as { options: { directory: string } }
            expect(file.options.directory).toBe('logs/metrics')
        })
    })

    it('is wired into resolveFroggerOptions', () => {
        const r = resolveFroggerOptions({ metrics: true })
        expect(r.metrics).not.toBe(false)
    })
})
