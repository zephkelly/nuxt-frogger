// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'
import type { ResolvedMetricClientTransport } from '../../src/runtime/metrics/shared/types/metric-transports'

const { useRuntimeConfigMock } = vi.hoisted(() => ({ useRuntimeConfigMock: vi.fn() }))
mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

import { MetricsQueueService } from '../../src/runtime/metrics/app/services/metrics-queue'

function metric(overrides: Partial<MetricObject> = {}): MetricObject {
    return { time: 0, name: 'web.vital.lcp', kind: 'gauge', value: 1, env: 'client', ...overrides }
}

function observeClientEntry(overrides: Partial<ResolvedMetricClientTransport> = {}): ResolvedMetricClientTransport {
    return {
        type: 'http',
        name: 'observe (https://observe.test)',
        baseUrl: 'https://observe.test',
        endpoint: '/api/observe/ingest/frogger/metrics',
        apiKey: 'obsk_public',
        apiKeyLocation: 'query',
        headers: {},
        publicKeyOk: true,
        ...overrides,
    }
}

function setConfig(metrics: Record<string, unknown>, baseUrl = '') {
    useRuntimeConfigMock.mockReturnValue({
        public: { frogger: { app: 'test-app', baseUrl, metrics } },
    })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
    useRuntimeConfigMock.mockReset()
    vi.unstubAllGlobals()
})

/** Let the floating fan-out promises settle. */
async function settle(turns = 5) {
    for (let i = 0; i < turns; i++) await Promise.resolve()
}

describe('MetricsQueueService', () => {
    it('sends immediately when batching is off', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]!
        expect(url).toBe('/api/_frogger/metrics')
        expect((opts as any).body.metrics).toHaveLength(1)
    })

    it('marks the in-session send keepalive so it survives page hide', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await Promise.resolve()

        expect((fetchMock.mock.calls[0]![1] as any).keepalive).toBe(true)
    })

    it('enforces the per-page cap and drops the overflow', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 2 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        q.enqueueMetric(metric())
        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('collects nothing for a sampled-out session', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: false })

        expect(q.isSampled()).toBe(false)
        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stamps the batch envelope with app, context and session', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 'sess-1', sampled: true })
        q.setContext({ effectiveType: '4g' })

        q.enqueueMetric(metric())
        await Promise.resolve()

        const body = (fetchMock.mock.calls[0]![1] as any).body
        expect(body.session).toEqual({ id: 'sess-1', sampled: true })
        expect(body.context).toEqual({ effectiveType: '4g' })
        expect(body.app.name).toBe('test-app')
    })
})

describe('MetricsQueueService beacon exit', () => {
    it('beacons to the exact ingest path when baseUrl is the default "/"', async () => {
        // Nuxt's app.baseURL default is '/'; naive concatenation would produce
        // the protocol-relative '//api/...' (host literally named "api").
        setConfig({ endpoint: '/api/_frogger/metrics', batch: { maxSize: 100, maxAge: 60000 }, maxEventsPerPage: 500 }, '/')
        const beacon = vi.fn().mockReturnValue(true)
        vi.stubGlobal('navigator', { sendBeacon: beacon })

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })
        q.enqueueMetric(metric())

        await q.flush(true)

        expect(beacon).toHaveBeenCalledTimes(1)
        expect(beacon.mock.calls[0]![0]).toBe('/api/_frogger/metrics')
    })

    it('stamps fresh meta onto each beaconed chunk', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: { maxSize: 100, maxAge: 60000 }, maxEventsPerPage: 500 })
        const beacon = vi.fn().mockReturnValue(true)
        vi.stubGlobal('navigator', { sendBeacon: beacon })

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })
        q.enqueueMetric(metric())

        await q.flush(true)

        const body = JSON.parse(beacon.mock.calls[0]![1] as string)
        expect(body.meta?.processChain).toEqual(['test-app'])
        expect(typeof body.meta?.time).toBe('number')
    })

    it('falls back to fetch(keepalive) when the beacon is refused', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: { maxSize: 100, maxAge: 60000 }, maxEventsPerPage: 500 })
        const beacon = vi.fn().mockReturnValue(false)
        const rawFetch = vi.fn().mockResolvedValue({})
        vi.stubGlobal('navigator', { sendBeacon: beacon })
        vi.stubGlobal('fetch', rawFetch)

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })
        q.enqueueMetric(metric())

        await q.flush(true)

        expect(rawFetch).toHaveBeenCalledTimes(1)
        expect(rawFetch.mock.calls[0]![0]).toBe('/api/_frogger/metrics')
        expect((rawFetch.mock.calls[0]![1] as any).keepalive).toBe(true)
    })
})

describe('MetricsQueueService client transport fan-out', () => {
    it('fans an in-session batch out to a client transport with query auth', async () => {
        setConfig({
            endpoint: '/api/_frogger/metrics',
            batch: false,
            maxEventsPerPage: 500,
            transports: [observeClientEntry()],
        })
        const q = new MetricsQueueService()
        q.setSession({ id: 'sess-1', sampled: true })
        q.setContext({ effectiveType: '4g' })

        q.enqueueMetric(metric())
        await settle()

        // One POST to the secondary sink, one to the primary ingest route.
        expect(fetchMock).toHaveBeenCalledTimes(2)

        const secondary = fetchMock.mock.calls.find(c => c[0] === '/api/observe/ingest/frogger/metrics')!
        const opts = secondary[1] as any
        expect(opts.baseURL).toBe('https://observe.test')
        expect(opts.query).toEqual({ key: 'obsk_public' })
        expect(opts.headers['x-api-key']).toBeUndefined()
        // Browser-direct batches carry the envelope (they never pass frogger ingest).
        expect(opts.body.context).toEqual({ effectiveType: '4g' })
        expect(opts.body.session).toEqual({ id: 'sess-1', sampled: true })
        expect(opts.body.app.name).toBe('test-app')
        expect(opts.body.meta?.processChain).toEqual(['test-app'])
    })

    it('still fans out when the primary endpoint is disabled (static site)', async () => {
        setConfig({
            endpoint: false,
            batch: false,
            maxEventsPerPage: 500,
            transports: [observeClientEntry()],
        })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await settle()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]![0]).toBe('/api/observe/ingest/frogger/metrics')
    })

    it('a secondary sink failure never rejects the primary send path', async () => {
        setConfig({
            endpoint: '/api/_frogger/metrics',
            batch: false,
            maxEventsPerPage: 500,
            transports: [observeClientEntry({ maxRetries: 0 })],
        })
        fetchMock.mockImplementation((url: string) =>
            url === '/api/observe/ingest/frogger/metrics'
                ? Promise.reject({ response: { status: 500 } })
                : Promise.resolve({}),
        )

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await settle(10)

        expect(fetchMock.mock.calls.some(c => c[0] === '/api/_frogger/metrics')).toBe(true)
    })

    it('drops a chunk on a non-429 4xx from the secondary sink without retrying', async () => {
        setConfig({
            endpoint: false,
            batch: false,
            maxEventsPerPage: 500,
            transports: [observeClientEntry()],
        })
        fetchMock.mockRejectedValue({ response: { status: 403 } })

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await settle(10)

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('beacons exit chunks to the client transport with the key on the URL', async () => {
        setConfig({
            endpoint: false,
            batch: { maxSize: 100, maxAge: 60000 },
            maxEventsPerPage: 500,
            transports: [observeClientEntry()],
        })
        const beacon = vi.fn().mockReturnValue(true)
        vi.stubGlobal('navigator', { sendBeacon: beacon })

        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })
        q.enqueueMetric(metric())

        await q.flush(true)

        expect(beacon).toHaveBeenCalledTimes(1)
        expect(beacon.mock.calls[0]![0]).toBe(
            'https://observe.test/api/observe/ingest/frogger/metrics?key=obsk_public',
        )
        const body = JSON.parse(beacon.mock.calls[0]![1] as string)
        expect(body.metrics).toHaveLength(1)
        expect(body.session).toEqual({ id: 's', sampled: true })
    })
})
