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
