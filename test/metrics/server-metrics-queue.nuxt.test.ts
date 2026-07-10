// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { ResolvedMetricServerTransport } from '../../src/runtime/metrics/shared/types/metric-transports'
import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { MetricObjectBatch } from '../../src/runtime/metrics/shared/types/metric-batch'

const { useRuntimeConfigMock, readRawBodyMock, getHeaderMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    readRawBodyMock: vi.fn(),
    getHeaderMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

// Mock only the two body/header helpers; keep eventHandler/createError/H3Error real.
vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>()
    return { ...actual, readRawBody: readRawBodyMock, getHeader: getHeaderMock }
})

import { ServerMetricsQueueService } from '../../src/runtime/metrics/server/services/server-metrics-queue'
import metricsHandler from '../../src/runtime/metrics/server/api/metrics.post'
import { getCapturedMetrics, clearCapturedMetrics, flushFroggerMetrics } from '../../src/testing'

function memoryEntry(name = 'cap'): ResolvedMetricServerTransport {
    return { type: 'memory', name }
}

function makeMetric(overrides: Partial<MetricObject> = {}): MetricObject {
    return { time: 0, name: 'web.vital.lcp', kind: 'gauge', value: 1.2, env: 'client', ...overrides }
}

function setConfig(transports: ResolvedMetricServerTransport[], extra: Record<string, unknown> = {}) {
    useRuntimeConfigMock.mockReturnValue({
        public: { frogger: { app: 'test-app', baseUrl: '' } },
        frogger: {
            metrics: { batch: false, transports, ...extra },
        },
    })
}

function freshQueue(): ServerMetricsQueueService {
    ;(ServerMetricsQueueService as unknown as { instance: unknown }).instance = null
    return ServerMetricsQueueService.getInstance()
}

beforeEach(() => {
    clearCapturedMetrics('cap')
})

afterEach(() => {
    ;(ServerMetricsQueueService as unknown as { instance: unknown }).instance = null
    useRuntimeConfigMock.mockReset()
    readRawBodyMock.mockReset()
    getHeaderMock.mockReset()
})

describe('ServerMetricsQueueService', () => {
    it('constructs a memory metric transport and captures an enqueued batch after flush', async () => {
        setConfig([memoryEntry('cap')])
        const queue = freshQueue()
        expect(queue.getTransporterInfo().mode).toBe('direct')

        queue.enqueueBatch({ metrics: [makeMetric({ name: 'web.vital.lcp' }), makeMetric({ name: 'web.vital.cls' })] })
        await flushFroggerMetrics()

        expect(getCapturedMetrics({ store: 'cap' }).map(m => m.name)).toEqual(['web.vital.lcp', 'web.vital.cls'])
        expect(getCapturedMetrics({ store: 'cap', name: 'web.vital.lcp' })).toHaveLength(1)
    })

    it('wraps transports in a batcher when batching is enabled', () => {
        setConfig([memoryEntry('cap')], { batch: { maxSize: 200, maxAge: 15000 } })
        const queue = freshQueue()
        expect(queue.getTransporterInfo().mode).toBe('batched')
        expect(queue.getTransporterInfo().downstreamTransporters).toContain('FroggerMetricsMemoryTransport')
    })
})

describe('metrics ingest route', () => {
    it('accepts a text/plain (sendBeacon) body and round-trips to the memory sink', async () => {
        setConfig([memoryEntry('cap')])
        freshQueue()

        const batch: MetricObjectBatch = { metrics: [makeMetric()], session: { id: 's1', sampled: true } }

        // sendBeacon posts a raw JSON string as text/plain — the handler must
        // parse it via readRawBody rather than relying on readBody's JSON path.
        readRawBodyMock.mockResolvedValue(JSON.stringify(batch))
        getHeaderMock.mockImplementation((_event: unknown, name: string) =>
            name === 'user-agent' ? 'Mozilla/5.0 (test)' : undefined,
        )

        const enqueueSpy = vi.spyOn(ServerMetricsQueueService.prototype, 'enqueueBatch')

        await (metricsHandler as unknown as (event: unknown) => Promise<unknown>)({})

        // UA stamped server-side onto the batch envelope (not per point).
        expect(enqueueSpy).toHaveBeenCalledTimes(1)
        expect(enqueueSpy.mock.calls[0]![0].context?.ua).toBe('Mozilla/5.0 (test)')

        await flushFroggerMetrics()
        expect(getCapturedMetrics({ store: 'cap' })).toHaveLength(1)
    })

    it('rejects a malformed body with 400', async () => {
        setConfig([memoryEntry('cap')])
        freshQueue()

        readRawBodyMock.mockResolvedValue('not json {')
        getHeaderMock.mockReturnValue(undefined)

        await expect(
            (metricsHandler as unknown as (event: unknown) => Promise<unknown>)({}),
        ).rejects.toMatchObject({ statusCode: 400 })
    })
})
