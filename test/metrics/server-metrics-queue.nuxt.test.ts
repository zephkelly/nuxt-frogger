// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { ResolvedMetricServerTransport } from '../../src/runtime/metrics/shared/types/metric-transports'
import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { MetricObjectBatch } from '../../src/runtime/metrics/shared/types/metric-batch'

const { useRuntimeConfigMock, readRawBodyMock, getHeaderMock, rateLimitCheckMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    readRawBodyMock: vi.fn(),
    getHeaderMock: vi.fn(),
    rateLimitCheckMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

// Mock only the two body/header helpers; keep eventHandler/createError/H3Error real.
vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>()
    return { ...actual, readRawBody: readRawBodyMock, getHeader: getHeaderMock }
})

// The ingest route shares the log rate limiter, whose KV layer references
// useStorage from #imports (unresolvable in this test env). Stub the limiter;
// its own behavior is covered by the rate-limiter tests.
vi.mock('../../src/runtime/rate-limiter', () => ({
    getFroggerRateLimiter: () => ({ check: rateLimitCheckMock }),
}))

import { ServerMetricsQueueService } from '../../src/runtime/metrics/server/services/server-metrics-queue'
import metricsHandler from '../../src/runtime/metrics/server/api/metrics.post'
import { getCapturedMetrics, clearCapturedMetrics, flushFroggerMetrics } from '../../src/testing'

function memoryEntry(name = 'cap'): ResolvedMetricServerTransport {
    return { type: 'memory', name }
}

function httpEntry(overrides: Record<string, unknown> = {}): ResolvedMetricServerTransport {
    return {
        type: 'http',
        name: 'observe (https://observe.test)',
        baseUrl: 'https://observe.test',
        endpoint: '/api/observe/ingest/frogger/metrics',
        apiKey: 'obsk_test',
        apiKeyLocation: 'header',
        headers: {},
        ...overrides,
    } as ResolvedMetricServerTransport
}

function makeMetric(overrides: Partial<MetricObject> = {}): MetricObject {
    return { id: 'fixture-id', time: 0, name: 'web.vital.lcp', kind: 'gauge', value: 1.2, env: 'client', ...overrides }
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

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    clearCapturedMetrics('cap')
    fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
    rateLimitCheckMock.mockResolvedValue(undefined)
})

afterEach(() => {
    ;(ServerMetricsQueueService as unknown as { instance: unknown }).instance = null
    useRuntimeConfigMock.mockReset()
    readRawBodyMock.mockReset()
    getHeaderMock.mockReset()
    rateLimitCheckMock.mockReset()
    vi.unstubAllGlobals()
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

    it('denormalises the batch envelope (app/context/session) onto every stored point', async () => {
        setConfig([memoryEntry('cap')])
        const queue = freshQueue()

        queue.enqueueBatch({
            metrics: [makeMetric(), makeMetric({ name: 'web.vital.cls' })],
            app: { name: 'origin-app', version: '1.2.3' },
            context: { ua: 'UA-string', effectiveType: '4g' },
            session: { id: 'sess-1', sampled: true },
        })
        await flushFroggerMetrics()

        const stored = getCapturedMetrics({ store: 'cap' })
        expect(stored).toHaveLength(2)
        for (const m of stored) {
            expect(m.source).toEqual({ name: 'origin-app', version: '1.2.3' })
            expect(m.context).toEqual({ ua: 'UA-string', effectiveType: '4g' })
            expect(m.session).toEqual({ id: 'sess-1', sampled: true })
        }
    })

    it('keeps an already-stamped point intact across a relay hop (??= idempotency)', async () => {
        setConfig([memoryEntry('cap')])
        const queue = freshQueue()

        queue.enqueueBatch({
            metrics: [makeMetric({
                source: { name: 'origin-app', version: '0.1.0' },
                context: { ua: 'origin-ua' },
                session: { id: 'origin-sess', sampled: true },
            })],
            app: { name: 'relay-app', version: '9.9.9' },
            context: { ua: 'relay-ua' },
            session: { id: 'relay-sess', sampled: true },
        })
        await flushFroggerMetrics()

        const [m] = getCapturedMetrics({ store: 'cap' })
        expect(m!.source).toEqual({ name: 'origin-app', version: '0.1.0' })
        expect(m!.context).toEqual({ ua: 'origin-ua' })
        expect(m!.session).toEqual({ id: 'origin-sess', sampled: true })
    })

    it('wraps transports in a batcher when batching is enabled', () => {
        setConfig([memoryEntry('cap')], { batch: { maxSize: 200, maxAge: 15000 } })
        const queue = freshQueue()
        expect(queue.getTransporterInfo().mode).toBe('batched')
        expect(queue.getTransporterInfo().downstreamTransporters).toContain('FroggerMetricsMemoryTransport')
    })

    it('drain() hands buffered metrics downstream, bypassing the sorting window', async () => {
        setConfig([memoryEntry('cap')], { batch: { maxSize: 200, maxAge: 60000, sortingWindowMs: 30000 } })
        const queue = freshQueue()

        queue.enqueueBatch({ metrics: [makeMetric({ time: Date.now() })] })
        expect(getCapturedMetrics({ store: 'cap' })).toHaveLength(0)

        await queue.drain()
        expect(getCapturedMetrics({ store: 'cap' })).toHaveLength(1)
    })
})

describe('ServerMetricsQueueService http relay', () => {
    it('constructs an http transport and POSTs the batch with header auth and fresh meta', async () => {
        setConfig([httpEntry()])
        const queue = freshQueue()

        queue.enqueueBatch({
            metrics: [makeMetric()],
            app: { name: 'origin-app', version: '1.0.0' },
            context: { ua: 'UA-string' },
            session: { id: 'sess-1', sampled: true },
        })
        await flushFroggerMetrics()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]! as [string, Record<string, any>]
        expect(url).toBe('/api/observe/ingest/frogger/metrics')
        expect(opts.baseURL).toBe('https://observe.test')
        expect(opts.headers['x-api-key']).toBe('obsk_test')
        expect(opts.query).toBeUndefined()

        const body = opts.body as MetricObjectBatch
        // The envelope survives the relay because it was denormalised onto the
        // points at ingest; the wire batch itself carries app + fresh meta.
        expect(body.metrics[0]!.context?.ua).toBe('UA-string')
        expect(body.metrics[0]!.session?.id).toBe('sess-1')
        expect(body.metrics[0]!.source?.name).toBe('origin-app')
        expect(body.app?.name).toBe('test-app')
        expect(body.meta?.processed).toBe(true)
        expect(body.meta?.processChain).toHaveLength(1)
        expect(body.meta?.processChain![0]).toMatch(/^frogger-metrics-http-/)
    })

    it('sends query auth when apiKeyLocation is query', async () => {
        setConfig([httpEntry({ apiKeyLocation: 'query' })])
        const queue = freshQueue()

        queue.enqueueBatch({ metrics: [makeMetric()] })
        await flushFroggerMetrics()

        const [, opts] = fetchMock.mock.calls[0]! as [string, Record<string, any>]
        expect(opts.query).toEqual({ key: 'obsk_test' })
        expect(opts.headers['x-api-key']).toBeUndefined()
    })

    it('chunks an oversize batch by maxBatchEvents', async () => {
        setConfig([httpEntry({ maxBatchEvents: 2 })])
        const queue = freshQueue()

        queue.enqueueBatch({ metrics: [makeMetric(), makeMetric(), makeMetric(), makeMetric(), makeMetric()] })
        await flushFroggerMetrics()

        expect(fetchMock).toHaveBeenCalledTimes(3)
        const sizes = fetchMock.mock.calls.map(c => (c[1] as any).body.metrics.length)
        expect(sizes).toEqual([2, 2, 1])
        // Every chunk (the splitter strips meta) is restamped with a chain.
        for (const call of fetchMock.mock.calls) {
            expect((call[1] as any).body.meta?.processChain).toHaveLength(1)
        }
    })

    it('drops on a non-429 4xx without retrying', async () => {
        setConfig([httpEntry()])
        const queue = freshQueue()
        fetchMock.mockRejectedValue({ response: { status: 401 } })

        queue.enqueueBatch({ metrics: [makeMetric()] })
        await flushFroggerMetrics()

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries a 5xx with backoff before giving up', async () => {
        vi.useFakeTimers()
        try {
            setConfig([httpEntry({ maxRetries: 2, retryDelay: 10 })])
            const queue = freshQueue()
            fetchMock.mockRejectedValue({ response: { status: 500 } })

            queue.enqueueBatch({ metrics: [makeMetric()] })
            const flushing = flushFroggerMetrics()
            await vi.runAllTimersAsync()
            await flushing

            // initial attempt + 2 retries
            expect(fetchMock).toHaveBeenCalledTimes(3)
        }
        finally {
            vi.useRealTimers()
        }
    })
})

describe('metrics ingest route', () => {
    it('accepts a text/plain (sendBeacon) body and round-trips the envelope to the sink', async () => {
        setConfig([memoryEntry('cap')])
        freshQueue()

        const batch: MetricObjectBatch = { metrics: [makeMetric()], session: { id: 's1', sampled: true } }

        // sendBeacon posts a raw JSON string as text/plain — the handler must
        // parse it via readRawBody rather than relying on readBody's JSON path.
        readRawBodyMock.mockResolvedValue(JSON.stringify(batch))
        getHeaderMock.mockImplementation((_event: unknown, name: string) =>
            name === 'user-agent' ? 'Mozilla/5.0 (test)' : undefined,
        )

        await (metricsHandler as unknown as (event: unknown) => Promise<unknown>)({})
        await flushFroggerMetrics()

        // The envelope must land ON the sink contents, not just the enqueue input.
        const stored = getCapturedMetrics({ store: 'cap' })
        expect(stored).toHaveLength(1)
        expect(stored[0]!.context?.ua).toBe('Mozilla/5.0 (test)')
        expect(stored[0]!.session).toEqual({ id: 's1', sampled: true })
    })

    it('consults the shared rate limiter before reading the body', async () => {
        setConfig([memoryEntry('cap')])
        freshQueue()

        rateLimitCheckMock.mockRejectedValue(
            Object.assign(new Error('Too Many Requests'), { statusCode: 429 }),
        )
        getHeaderMock.mockReturnValue(undefined)

        await expect(
            (metricsHandler as unknown as (event: unknown) => Promise<unknown>)({}),
        ).rejects.toMatchObject({ statusCode: 429 })
        expect(readRawBodyMock).not.toHaveBeenCalled()
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
