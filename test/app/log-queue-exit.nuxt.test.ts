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
        id: `id-${msg}`,
        time: Date.now(), lvl: 3, type: 'log', msg, ctx: {}, env: 'client',
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    } as unknown as LoggerObject
}

function setConfig(publicFrogger: Record<string, unknown> = {}) {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                serverModule: true,
                app: 'test-app',
                resource: { 'service.name': 'test-app', 'deployment.environment': 'test' },
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

let beaconMock: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    beaconMock = vi.fn().mockReturnValue(true)
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('navigator', { sendBeacon: beaconMock })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
})

afterEach(() => {
    vi.unstubAllGlobals()
    useRuntimeConfigMock.mockReset()
})

describe('LogQueueService.exitFlush', () => {
    it('beacons the buffered batch instead of losing it to a cancelled fetch', () => {
        setConfig()
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog('before-exit'))

        queue.exitFlush()

        expect(beaconMock).toHaveBeenCalledTimes(1)
        const [url, body] = beaconMock.mock.calls[0]!
        expect(url).toBe(DEFAULT_ENDPOINT)
        expect(JSON.parse(body as string).logs[0].msg).toBe('before-exit')
    })

    it('stamps the schema version and resource on the exit batch', () => {
        setConfig()
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())

        queue.exitFlush()

        const batch = JSON.parse(beaconMock.mock.calls[0]![1] as string)
        expect(batch.meta.schema).toBe('frogger.logs/1')
        expect(batch.resource).toEqual({ 'service.name': 'test-app', 'deployment.environment': 'test' })
    })

    it('sends once when both exit events fire', () => {
        setConfig()
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())

        queue.exitFlush()
        queue.exitFlush()

        expect(beaconMock).toHaveBeenCalledTimes(1)
    })

    it('re-arms after a bfcache restore', () => {
        setConfig()
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog('first'))
        queue.exitFlush()

        queue.resumeAfterExit()
        queue.enqueueLog(makeLog('second'))
        queue.exitFlush()

        expect(beaconMock).toHaveBeenCalledTimes(2)
    })

    it('falls back to keepalive fetch when the beacon is refused', () => {
        setConfig()
        beaconMock.mockReturnValue(false)
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())

        queue.exitFlush()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', keepalive: true })
    })

    it('splits an oversize batch so no chunk exceeds the beacon budget', () => {
        setConfig()
        const queue = new LogQueueService()
        // Each row carries a ~2 KiB payload, so 40 of them cross the 16 KiB cap.
        for (let i = 0; i < 40; i++) {
            const log = makeLog(`row-${i}`)
            log.ctx = { blob: 'x'.repeat(2048) }
            queue.enqueueLog(log)
        }

        queue.exitFlush()

        expect(beaconMock.mock.calls.length).toBeGreaterThan(1)
        for (const [, body] of beaconMock.mock.calls) {
            expect((body as string).length).toBeLessThanOrEqual(16 * 1024)
        }
    })

    it('uses keepalive fetch for a header-auth client transport, which a beacon cannot express', () => {
        setConfig({
            endpoint: false,
            serverModule: false,
            transports: [{
                name: 'remote',
                baseUrl: 'https://ingest.example.com',
                endpoint: '/logs',
                apiKey: 'secret',
                apiKeyLocation: 'header',
                headers: {},
            }],
        })
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())

        queue.exitFlush()

        expect(beaconMock).not.toHaveBeenCalled()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toBe('https://ingest.example.com/logs')
        expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'secret' })
    })

    it('puts a query-auth key on the URL so a beacon can carry it', () => {
        setConfig({
            endpoint: false,
            serverModule: false,
            transports: [{
                name: 'observe',
                baseUrl: 'https://observe.example.com',
                endpoint: '/ingest',
                apiKey: 'pub-key',
                apiKeyLocation: 'query',
                headers: {},
            }],
        })
        const queue = new LogQueueService()
        queue.enqueueLog(makeLog())

        queue.exitFlush()

        expect(beaconMock).toHaveBeenCalledTimes(1)
        expect(beaconMock.mock.calls[0]![0]).toBe('https://observe.example.com/ingest?key=pub-key')
    })

    it('does nothing when the queue is empty', () => {
        setConfig()
        const queue = new LogQueueService()

        queue.exitFlush()

        expect(beaconMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
