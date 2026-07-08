// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

const { useRuntimeConfigMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(() => ({
        public: { frogger: { app: 'test-app', baseUrl: '' } },
    })),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

import { HttpTransport } from '../../src/runtime/logger/_transports/http-transport'

function makeLog(): LoggerObject {
    return {
        time: Date.now(),
        lvl: 3,
        type: 'log',
        msg: 'hello',
        ctx: {},
        env: 'test',
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    } as unknown as LoggerObject
}

describe('HttpTransport.createRequestHeaders (Gap B + apiKey)', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({})
        vi.stubGlobal('$fetch', fetchMock)
    })

    async function headersFor(options: Record<string, unknown>): Promise<Record<string, string>> {
        const transport = new HttpTransport({ endpoint: '/ingest', ...options } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        return fetchMock.mock.calls[0]![1].headers as Record<string, string>
    }

    it('merges configured headers into the request (regression: was dropped)', async () => {
        const headers = await headersFor({ headers: { 'x-test': '1', authorization: 'Bearer t' } })
        expect(headers['x-test']).toBe('1')
        expect(headers['authorization']).toBe('Bearer t')
    })

    it('sends apiKey as x-api-key', async () => {
        const headers = await headersFor({ apiKey: 'secret-key' })
        expect(headers['x-api-key']).toBe('secret-key')
    })

    it('still sets Frogger trace + processing headers alongside custom headers', async () => {
        const headers = await headersFor({ headers: { 'x-test': '1' }, apiKey: 'k' })
        expect(headers['x-test']).toBe('1')
        expect(headers['x-api-key']).toBe('k')
        expect(headers['x-frogger-processed']).toBe('true')
        expect(headers['traceparent']).toBeTruthy()
        expect(headers['x-frogger-reporter-id']).toBeTruthy()
    })

    it("does not let custom headers clobber Frogger's own trace/identity headers", async () => {
        const headers = await headersFor({
            headers: { 'x-frogger-processed': 'false', 'x-frogger-reporter-id': 'spoofed' },
        })
        expect(headers['x-frogger-processed']).toBe('true')
        expect(headers['x-frogger-reporter-id']).not.toBe('spoofed')
    })

    it('omits x-api-key entirely when no apiKey is set', async () => {
        const headers = await headersFor({})
        expect(headers).not.toHaveProperty('x-api-key')
    })
})

describe('HttpTransport query auth', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({})
        vi.stubGlobal('$fetch', fetchMock)
    })

    it('sends the key as ?key= and omits x-api-key when apiKeyLocation is query', async () => {
        const transport = new HttpTransport({ endpoint: '/ingest', apiKey: 'k', apiKeyLocation: 'query' } as any)
        await transport.logBatch([makeLog()])

        const [, opts] = fetchMock.mock.calls[0]!
        expect(opts.query).toEqual({ key: 'k' })
        expect(opts.headers).not.toHaveProperty('x-api-key')
    })

    it('sends x-api-key and no query in header mode (default)', async () => {
        const transport = new HttpTransport({ endpoint: '/ingest', apiKey: 'k' } as any)
        await transport.logBatch([makeLog()])

        const [, opts] = fetchMock.mock.calls[0]!
        expect(opts.headers['x-api-key']).toBe('k')
        expect(opts.query).toBeUndefined()
    })
})

describe('HttpTransport retry semantics (revived dead retry code)', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn()
        vi.stubGlobal('$fetch', fetchMock)
    })

    it('drops immediately on a non-429 4xx (no retry)', async () => {
        fetchMock.mockRejectedValue({ response: { status: 400 } })
        const transport = new HttpTransport({ endpoint: '/ingest', maxRetries: 3, retryDelay: 1 } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries a 429 up to maxRetries then drops', async () => {
        fetchMock.mockRejectedValue({ response: { status: 429 } })
        const transport = new HttpTransport({ endpoint: '/ingest', maxRetries: 2, retryDelay: 1 } as any)
        await transport.logBatch([makeLog()])
        // initial + 2 retries
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('retries a 5xx up to maxRetries then drops', async () => {
        fetchMock.mockRejectedValue({ response: { status: 500 } })
        const transport = new HttpTransport({ endpoint: '/ingest', maxRetries: 2, retryDelay: 1 } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('retries a network error (no response) then drops', async () => {
        fetchMock.mockRejectedValue(new Error('network down'))
        const transport = new HttpTransport({ endpoint: '/ingest', maxRetries: 2, retryDelay: 1 } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('succeeds on a retry after a transient failure', async () => {
        fetchMock
            .mockRejectedValueOnce({ response: { status: 503 } })
            .mockResolvedValueOnce({})
        const transport = new HttpTransport({ endpoint: '/ingest', maxRetries: 3, retryDelay: 1 } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry when retryOnFailure is false', async () => {
        fetchMock.mockRejectedValue({ response: { status: 500 } })
        const transport = new HttpTransport({ endpoint: '/ingest', retryOnFailure: false } as any)
        await transport.logBatch([makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe('HttpTransport batch splitting', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({})
        vi.stubGlobal('$fetch', fetchMock)
    })

    it('splits an outgoing batch by event count', async () => {
        const transport = new HttpTransport({ endpoint: '/ingest', maxBatchEvents: 2 } as any)
        await transport.logBatch([makeLog(), makeLog(), makeLog(), makeLog(), makeLog()])
        // 5 logs / 2 per chunk = 3 requests
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('splits an outgoing batch by body bytes', async () => {
        const transport = new HttpTransport({ endpoint: '/ingest', maxBodyBytes: 400 } as any)
        await transport.logBatch([makeLog(), makeLog(), makeLog(), makeLog()])
        expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    })

    it('sends a single request when no caps are set', async () => {
        const transport = new HttpTransport({ endpoint: '/ingest' } as any)
        await transport.logBatch([makeLog(), makeLog(), makeLog()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
