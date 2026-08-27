// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

const { useRuntimeConfigMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

import { LogQueueService } from '../../src/runtime/app/services/log-queue'

const DEFAULT_ENDPOINT = '/api/_frogger/logs'

function makeLog(msg = 'hello'): LoggerObject {
    return {
        time: Date.now(), lvl: 3, type: 'log', msg, ctx: {}, env: 'test',
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    } as unknown as LoggerObject
}

function setConfig(publicFrogger: Record<string, unknown>) {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                serverModule: false,
                app: 'test-app',
                endpoint: DEFAULT_ENDPOINT,
                baseUrl: '',
                batch: { maxSize: 100, maxAge: 3000 },
                scrub: false,
                transports: [],
                ...publicFrogger,
            },
        },
    })
}

const OBSERVE = {
    name: 'observe',
    baseUrl: 'https://observe.example.com',
    endpoint: '/api/observe/ingest',
    apiKey: 'ingest-key',
    headers: {},
    maxRetries: 3,
    retryDelay: 10,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    useRuntimeConfigMock.mockReset()
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('LogQueueService client transport fan-out', () => {
    it('static app (serverModule:false, default endpoint) still fans out to a client transport with x-api-key', async () => {
        setConfig({ serverModule: false, transports: [OBSERVE] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]!
        expect(url).toBe('/api/observe/ingest')
        expect(opts.baseURL).toBe('https://observe.example.com')
        expect(opts.method).toBe('POST')
        expect(opts.headers['x-api-key']).toBe('ingest-key')
    })

    it('fans out to BOTH the primary and the client transport when a backend exists', async () => {
        setConfig({ serverModule: true, transports: [OBSERVE] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        const calledUrls = fetchMock.mock.calls.map(c => c[0])
        expect(calledUrls).toContain(DEFAULT_ENDPOINT)
        expect(calledUrls).toContain('/api/observe/ingest')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('a secondary 4xx drops that sink without retrying or blocking the primary', async () => {
        setConfig({ serverModule: true, transports: [OBSERVE] })

        fetchMock.mockImplementation((_url: string, opts: any) => {
            if (opts?.baseURL === 'https://observe.example.com') {
                return Promise.reject({ response: { status: 400 } })
            }
            return Promise.resolve({})
        })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()
        await tick()

        const secondaryCalls = fetchMock.mock.calls.filter(c => c[1]?.baseURL === 'https://observe.example.com')
        const primaryCalls = fetchMock.mock.calls.filter(c => c[0] === DEFAULT_ENDPOINT)
        // secondary tried exactly once (4xx → no retry loop)
        expect(secondaryCalls).toHaveLength(1)
        // primary still delivered
        expect(primaryCalls).toHaveLength(1)
    })

    it('retries a secondary on 5xx up to maxRetries, then drops', async () => {
        setConfig({ serverModule: false, transports: [{ ...OBSERVE, maxRetries: 2, retryDelay: 1 }] })

        fetchMock.mockRejectedValue({ response: { status: 500 } })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        // allow the bounded retry chain (1ms delays) to run out
        await new Promise(resolve => setTimeout(resolve, 50))

        // initial attempt + 2 retries = 3
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('does not send anywhere when there is no primary and no client transports', async () => {
        setConfig({ serverModule: false, transports: [] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('relay app (serverModule:false, default endpoint, baseUrl set) sends the primary POST to the relay origin', async () => {
        setConfig({ serverModule: false, baseUrl: 'https://api.example.com', transports: [] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]!
        expect(url).toBe(DEFAULT_ENDPOINT)
        expect(opts.baseURL).toBe('https://api.example.com')
        expect(opts.method).toBe('POST')
    })

    it('endpoint:false suppresses the primary POST but still fans out to client transports', async () => {
        setConfig({ serverModule: true, endpoint: false, transports: [OBSERVE] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        const calledUrls = fetchMock.mock.calls.map(c => c[0])
        expect(calledUrls).not.toContain(DEFAULT_ENDPOINT)
        expect(calledUrls).toContain('/api/observe/ingest')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('query-auth client transport sends ?key= and no x-api-key header', async () => {
        const queryTransport = { ...OBSERVE, apiKeyLocation: 'query' as const }
        setConfig({ serverModule: false, transports: [queryTransport] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())
        await queue.flush()
        await tick()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [, opts] = fetchMock.mock.calls[0]!
        expect(opts.query).toEqual({ key: 'ingest-key' })
        expect(opts.headers).not.toHaveProperty('x-api-key')
    })

    it('splits a client-transport batch by caps into independent requests', async () => {
        const capped = { ...OBSERVE, maxBatchEvents: 2 }
        setConfig({ serverModule: false, transports: [capped] })

        const queue = new LogQueueService()
        queue.enqueueLog(makeLog('1'))
        queue.enqueueLog(makeLog('2'))
        queue.enqueueLog(makeLog('3'))
        queue.enqueueLog(makeLog('4'))
        queue.enqueueLog(makeLog('5'))
        await queue.flush()
        await tick()

        // 5 logs / 2 per chunk = 3 requests to the observe sink
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })
})
