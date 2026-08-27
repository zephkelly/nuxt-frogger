// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

const { useRuntimeConfigMock, useNuxtAppMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    useNuxtAppMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)
mockNuxtImport('useState', () => <T>(_key: string, init?: () => T) => ref(init ? init() : undefined))

import { ClientFrogger } from '../../src/runtime/logger/client'
import { LogQueueService } from '../../src/runtime/app/services/log-queue'

const DEFAULT_ENDPOINT = '/api/_frogger/logs'

let fetchMock: ReturnType<typeof vi.fn>

function setConfig(overrides: Record<string, unknown> = {}) {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                serverModule: true,
                app: 'test-app',
                endpoint: DEFAULT_ENDPOINT,
                baseUrl: '',
                batch: { maxSize: 100, maxAge: 3000 },
                scrub: false,
                transports: [],
                ...overrides,
            },
        },
    })
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
    // A fresh, bare app each test — nothing has provided `$logQueue`.
    useNuxtAppMock.mockReturnValue({})
    setConfig()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useRuntimeConfigMock.mockReset()
    useNuxtAppMock.mockReset()
})

describe('client delivery never silently drops a log', () => {
    it('falls back to a direct send when the queue path throws (log is delivered, not dropped)', async () => {
        // Force the batching path to blow up the way an unready/undefined queue
        // historically did.
        vi.spyOn(LogQueueService.prototype, 'enqueueLog').mockImplementation(() => {
            throw new Error('queue exploded')
        })
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        const logger = new ClientFrogger(ref(true), { consoleOutput: false })
        logger.info('important')

        await tick()
        await tick()

        // The log reached the network via the fallback direct send.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]![0]).toBe(DEFAULT_ENDPOINT)
        // Delivery succeeded, so nothing ungated needed to surface.
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('relay app (serverModule:false, default endpoint, baseUrl set): the fallback direct send still delivers', async () => {
        // Regression: the old sendLogImmediate guard ignored baseUrl and
        // silently dropped exactly this configuration's fallback sends.
        setConfig({ serverModule: false, baseUrl: 'https://api.example.com' })
        vi.spyOn(LogQueueService.prototype, 'enqueueLog').mockImplementation(() => {
            throw new Error('queue exploded')
        })
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        const logger = new ClientFrogger(ref(true), { consoleOutput: false })
        logger.info('important')

        await tick()
        await tick()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]![0]).toBe(DEFAULT_ENDPOINT)
        expect(fetchMock.mock.calls[0]![1].baseURL).toBe('https://api.example.com')
        expect(consoleError).not.toHaveBeenCalled()
    })

    it('sinkless app (serverModule:false, default endpoint, no baseUrl): the direct send is skipped, not attempted', async () => {
        setConfig({ serverModule: false, baseUrl: '' })
        vi.spyOn(LogQueueService.prototype, 'enqueueLog').mockImplementation(() => {
            throw new Error('queue exploded')
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const logger = new ClientFrogger(ref(true), { consoleOutput: false })
        logger.info('nowhere to go')

        await tick()
        await tick()

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('surfaces an ungated console error when BOTH the queue and the direct send fail', async () => {
        vi.spyOn(LogQueueService.prototype, 'enqueueLog').mockImplementation(() => {
            throw new Error('queue exploded')
        })
        fetchMock.mockRejectedValue(new Error('network down'))
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        const logger = new ClientFrogger(ref(true), { consoleOutput: false })
        logger.info('critical')

        await tick()
        await tick()

        // The direct-send fallback was attempted...
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // ...and because it also failed, the drop is announced ungated (the
        // internal diagnostics channel is silent in production, so this must NOT
        // route through froggerInternal).
        expect(consoleError).toHaveBeenCalled()
        const announced = consoleError.mock.calls.some(args =>
            args.some(a => typeof a === 'string' && a.includes('Frogger')),
        )
        expect(announced).toBe(true)
    })
})
