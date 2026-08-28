// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { LoggerObjectBatch } from '../../src/runtime/shared/types/batch'
import type { ResolvedServerTransport } from '../../src/runtime/shared/types/transports'

const { useRuntimeConfigMock, rawBodyMock, getHeaderMock, rateLimitCheckMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    rawBodyMock: vi.fn(),
    getHeaderMock: vi.fn(),
    rateLimitCheckMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>()
    return { ...actual, getHeader: getHeaderMock }
})

// The route's rate limiter reaches useStorage through its KV layer, which is
// unresolvable here; its own behaviour is covered by the rate-limiter specs.
vi.mock('../../src/runtime/rate-limiter', () => ({
    getFroggerRateLimiter: () => ({ check: rateLimitCheckMock }),
}))

vi.mock('../../src/runtime/server/utils/read-bounded-body', () => ({
    readBoundedRawBody: rawBodyMock,
    safeRequestIp: () => '203.0.113.7',
}))

vi.mock('../../src/runtime/websocket/state/factory', () => ({
    createWebSocketStateKVLayer: vi.fn(() => ({})),
}))

import loggerHandler from '../../src/runtime/server/api/logger.post'
import { ServerLogQueueService } from '../../src/runtime/server/services/server-log-queue'
import { getCapturedLogs, clearCapturedLogs, flushFrogger } from '../../src/testing'

const memoryEntry = (name = 'cap'): ResolvedServerTransport => ({ type: 'memory', name })

function setConfig(transports: ResolvedServerTransport[]) {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                app: { name: 'my-app', version: '1.0.0' },
                resource: { 'service.name': 'my-app', 'deployment.environment': 'test' },
            },
        },
        frogger: {
            batch: false,
            scrub: false,
            transports,
            resource: { 'service.name': 'my-app', 'deployment.environment': 'test' },
        },
    })
}

function freshQueue() {
    // @ts-expect-error - resetting the module singleton between cases
    ServerLogQueueService.instance = null
    return ServerLogQueueService.getInstance()
}

function makeLog(overrides: Partial<LoggerObject> = {}): LoggerObject {
    return {
        id: 'e0000000-0000-7000-8000-000000000001',
        time: Date.now(),
        lvl: 3,
        sev: 9,
        type: 'info',
        msg: 'hello',
        ctx: {},
        env: 'client',
        trace: { traceId: 'trace-a', spanId: 'span-a' },
        ...overrides,
    }
}

const post = (batch: unknown) => {
    rawBodyMock.mockResolvedValue(JSON.stringify(batch))
    return (loggerHandler as unknown as (event: unknown) => Promise<unknown>)({})
}

describe('log ingest route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearCapturedLogs('cap')
        rateLimitCheckMock.mockResolvedValue(undefined)
        getHeaderMock.mockReturnValue(undefined)
        setConfig([memoryEntry()])
        freshQueue()
    })

    it('accepts a relayed batch instead of rejecting it with a 400', async () => {
        // Every frogger-to-frogger relay sets these; treating them as a loop
        // rejected 100% of legitimate relay traffic.
        getHeaderMock.mockImplementation((_e: unknown, name: string) => {
            if (name === 'x-frogger-processed') return 'true'
            if (name === 'x-frogger-reporter-id') return 'frogger-http-abc'
            if (name === 'x-frogger-source') return 'upstream-app'
            return undefined
        })

        const batch: LoggerObjectBatch = {
            logs: [makeLog()],
            app: { name: 'upstream-app', version: '2.0.0' },
            meta: { schema: 'frogger.logs/1', processed: true, processChain: ['frogger-http-abc'], time: Date.now() },
        }

        await post(batch)
        await flushFrogger()

        expect(getCapturedLogs({ name: 'cap' })).toHaveLength(1)
    })

    it('rejects a genuine self-loop where the source is this app', async () => {
        getHeaderMock.mockImplementation((_e: unknown, name: string) => {
            if (name === 'x-frogger-processed') return 'true'
            if (name === 'x-frogger-reporter-id') return 'frogger-http-abc'
            if (name === 'x-frogger-source') return 'my-app'
            return undefined
        })

        await expect(post({
            logs: [makeLog()],
            app: { name: 'my-app' },
            meta: { processed: true, processChain: ['frogger-http-abc'], time: Date.now() },
        })).rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_LOOP_DETECTED' } })
    })

    it('rejects a duplicated hop in the process chain', async () => {
        await expect(post({
            logs: [makeLog()],
            meta: { processed: true, processChain: ['a', 'b', 'a'], time: Date.now() },
        })).rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_LOOP_DETECTED' } })
    })

    it('rejects a batch whose logs are not an array', async () => {
        await expect(post({ logs: 'nope' }))
            .rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_BAD_BATCH' } })
    })

    it('rejects a batch over the per-batch log cap', async () => {
        await expect(post({ logs: Array.from({ length: 1001 }, () => makeLog()) }))
            .rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_BATCH_TOO_LARGE' } })
    })

    it('rejects a row with a non-numeric time', async () => {
        await expect(post({ logs: [makeLog({ time: 'now' as unknown as number })] }))
            .rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_BAD_LOG' } })
    })

    it('rejects an unparseable body', async () => {
        rawBodyMock.mockResolvedValue('{not json')
        await expect((loggerHandler as unknown as (e: unknown) => Promise<unknown>)({}))
            .rejects.toMatchObject({ statusCode: 400, data: { error: 'FROGGER_BAD_BODY' } })
    })

    it('clamps a future-dated row into the accepted window', async () => {
        const future = Date.now() + 60 * 60 * 1000
        await post({ logs: [makeLog({ time: future })] })
        await flushFrogger()

        const stored = getCapturedLogs({ name: 'cap' })
        expect(stored[0]!.time).toBeLessThan(future)
    })

    it('denormalises the resource and observed time onto every row', async () => {
        const resource = { 'service.name': 'upstream', 'deployment.environment': 'staging' }
        await post({ logs: [makeLog()], app: { name: 'upstream' }, resource })
        await flushFrogger()

        const stored = getCapturedLogs({ name: 'cap' })
        expect(stored[0]!.resource).toEqual(resource)
        expect(typeof stored[0]!.obsTime).toBe('number')
    })

    it('mints an id for a row that arrived without one', async () => {
        const { id: _dropped, ...idless } = makeLog()
        await post({ logs: [idless] })
        await flushFrogger()

        expect(getCapturedLogs({ name: 'cap' })[0]!.id).toBeTruthy()
    })

    it('consults the rate limiter before reading the body', async () => {
        rateLimitCheckMock.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))

        await expect((loggerHandler as unknown as (e: unknown) => Promise<unknown>)({}))
            .rejects.toMatchObject({ statusCode: 429 })
        expect(rawBodyMock).not.toHaveBeenCalled()
    })
})
