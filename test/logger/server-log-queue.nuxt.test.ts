// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ResolvedServerTransport } from '../../src/runtime/shared/types/transports'
import type { IFroggerTransport } from '../../src/runtime/logger/_transports/types'

const { useRuntimeConfigMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

// The queue service transitively imports the websocket state factory, which
// references useStorage from #imports (unresolvable in this test env). Websocket
// is disabled in every case here, so stub the factory to keep the graph clean.
vi.mock('../../src/runtime/websocket/state/factory', () => ({
    createWebSocketStateKVLayer: vi.fn(() => ({})),
}))

import { ServerLogQueueService } from '../../src/runtime/server/services/server-log-queue'
import { DEFAULT_FILE } from '../../src/runtime/shared/types/file'
import { getCapturedLogs, clearCapturedLogs, flushFrogger } from '../../src/testing'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

function fileEntry(overrides: Partial<typeof DEFAULT_FILE> = {}): ResolvedServerTransport {
    return {
        type: 'file',
        name: 'file',
        options: { ...DEFAULT_FILE, directory: join(tmpdir(), 'frogger-test-logs'), ...overrides },
    }
}

function memoryEntry(name = 'memory'): ResolvedServerTransport {
    return { type: 'memory', name }
}

function makeLog(overrides: Partial<LoggerObject> = {}): LoggerObject {
    return {
        time: 0,
        lvl: 3,
        type: 'info',
        msg: 'captured',
        ctx: {},
        env: 'server',
        trace: { traceId: 'trace-a', spanId: 'span-a' },
        ...overrides,
    }
}

function httpEntry(name = 'http'): ResolvedServerTransport {
    return {
        type: 'http',
        name,
        baseUrl: 'https://x.dev',
        endpoint: '/ingest',
        headers: {},
    }
}

function setConfig(transports: ResolvedServerTransport[], extra: Record<string, unknown> = {}) {
    useRuntimeConfigMock.mockReturnValue({
        public: { frogger: { app: 'test-app', baseUrl: '' } },
        frogger: {
            scrub: false,
            batch: { maxSize: 200, maxAge: 15000 },
            websocket: false,
            transports,
            ...extra,
        },
    })
}

function freshQueue(): ServerLogQueueService {
    // Reset the singleton so each test builds its own transport set.
    ;(ServerLogQueueService as unknown as { instance: unknown }).instance = null
    return ServerLogQueueService.getInstance()
}

function downstreamNames(queue: ServerLogQueueService): string[] {
    const info = queue.getReporterInfo()
    const reporters = (info.downstreamReporters ?? []) as unknown as IFroggerTransport[]
    return reporters.map(r => r.name)
}

beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
})

afterEach(() => {
    ;(ServerLogQueueService as unknown as { instance: unknown }).instance = null
    useRuntimeConfigMock.mockReset()
    vi.unstubAllGlobals()
})

describe('ServerLogQueueService transport construction', () => {
    it('constructs NO FileTransport for a bare (empty transports) config', () => {
        setConfig([])
        const queue = freshQueue()
        expect(queue.getReporterInfo().mode).toBe('batched')
        expect(downstreamNames(queue)).not.toContain('FroggerFileTransport')
        expect(downstreamNames(queue)).toEqual([])
    })

    it('constructs a FileTransport for a file entry', () => {
        setConfig([fileEntry()])
        const queue = freshQueue()
        expect(downstreamNames(queue)).toContain('FroggerFileTransport')
    })

    it('constructs an HttpTransport for an http entry', () => {
        setConfig([httpEntry()])
        const queue = freshQueue()
        expect(downstreamNames(queue)).toContain('FroggerHttpTransport')
    })

    it('preserves user array order across mixed entries', () => {
        setConfig([httpEntry('a'), fileEntry(), httpEntry('b')])
        const queue = freshQueue()
        expect(downstreamNames(queue)).toEqual([
            'FroggerHttpTransport', 'FroggerFileTransport', 'FroggerHttpTransport',
        ])
    })

    it('wraps transports in a BatchTransport when batching is enabled', () => {
        setConfig([httpEntry()])
        const queue = freshQueue()
        expect(queue.getReporterInfo().mode).toBe('batched')
    })

    it('uses direct transporters when batching is disabled', () => {
        setConfig([httpEntry()], { batch: false })
        const queue = freshQueue()
        const info = queue.getReporterInfo()
        expect(info.mode).toBe('direct')
        expect(info.directTransporters).toContain('FroggerHttpTransport')
    })

    it('isolates a bad entry so the rest still construct', () => {
        // An http entry with no endpoint throws in the HttpTransport ctor.
        const bad: ResolvedServerTransport = { type: 'http', name: 'bad', baseUrl: '', endpoint: '', headers: {} }
        setConfig([bad, httpEntry('good')])
        const queue = freshQueue()
        expect(downstreamNames(queue)).toEqual(['FroggerHttpTransport'])
    })

    it('constructs a MemoryTransport for a memory entry', () => {
        setConfig([memoryEntry()])
        const queue = freshQueue()
        expect(downstreamNames(queue)).toContain('FroggerMemoryTransport')
    })

    it('captures an enqueued batch readable via getCapturedLogs after flush', async () => {
        clearCapturedLogs('cap')
        // `batch: false` is the documented recommendation for deterministic
        // capture: logs reach the memory transport synchronously on enqueue.
        setConfig([memoryEntry('cap')], { batch: false })
        const queue = freshQueue()

        queue.enqueueBatch({ logs: [makeLog({ msg: 'first' }), makeLog({ msg: 'second' })] })
        await flushFrogger()

        expect(getCapturedLogs({ name: 'cap' }).map(l => l.msg)).toEqual(['first', 'second'])
        expect(getCapturedLogs({ name: 'cap', msg: 'first' })).toHaveLength(1)
    })

    it('addTransport still registers a transport imperatively', () => {
        setConfig([])
        const queue = freshQueue()
        const fake: IFroggerTransport = {
            name: 'FakeTransport',
            transportId: 'fake',
            log: vi.fn(),
            logBatch: vi.fn(),
        } as unknown as IFroggerTransport
        queue.addTransport(fake)
        expect(downstreamNames(queue)).toContain('FakeTransport')
    })
})

describe('ServerLogQueueService origin app attribution', () => {
    it('stamps the envelope app onto every log that has no source of its own', async () => {
        clearCapturedLogs('origin')
        setConfig([memoryEntry('origin')], { batch: false })
        const queue = freshQueue()

        queue.enqueueBatch({
            logs: [makeLog({ msg: 'first' }), makeLog({ msg: 'second' })],
            app: { name: 'paincoach-dash', version: '2.1.0' },
        })
        await flushFrogger()

        const captured = getCapturedLogs({ name: 'origin' })
        expect(captured).toHaveLength(2)
        for (const log of captured) {
            expect(log.source).toEqual({ name: 'paincoach-dash', version: '2.1.0' })
        }
    })

    it('does not overwrite a log that already carries its own source', async () => {
        clearCapturedLogs('origin')
        setConfig([memoryEntry('origin')], { batch: false })
        const queue = freshQueue()

        queue.enqueueBatch({
            logs: [
                makeLog({ msg: 'own', source: { name: 'paincoach-app-web', version: '1.0.0' } }),
                makeLog({ msg: 'inherited' }),
            ],
            app: { name: 'paincoach-dash', version: '2.1.0' },
        })
        await flushFrogger()

        const captured = getCapturedLogs({ name: 'origin' })
        expect(captured.find(l => l.msg === 'own')?.source?.name).toBe('paincoach-app-web')
        expect(captured.find(l => l.msg === 'inherited')?.source?.name).toBe('paincoach-dash')
    })

    it('defaults the version to empty when the envelope carries a name only', async () => {
        clearCapturedLogs('origin')
        setConfig([memoryEntry('origin')], { batch: false })
        const queue = freshQueue()

        queue.enqueueBatch({ logs: [makeLog()], app: { name: 'paincoach-main' } })
        await flushFrogger()

        expect(getCapturedLogs({ name: 'origin' })[0]?.source).toEqual({ name: 'paincoach-main', version: '' })
    })

    it('leaves source unset when the envelope carries no app', async () => {
        clearCapturedLogs('origin')
        setConfig([memoryEntry('origin')], { batch: false })
        const queue = freshQueue()

        queue.enqueueBatch({ logs: [makeLog()] })
        await flushFrogger()

        expect(getCapturedLogs({ name: 'origin' })[0]?.source).toBeUndefined()
    })
})


describe('ServerLogQueueService drain', () => {
    function setBatchedConfig(name: string) {
        useRuntimeConfigMock.mockReturnValue({
            public: {
                frogger: {
                    app: 'test-app',
                    baseUrl: '',
                    batch: { maxSize: 200, maxAge: 15000, sortingWindowMs: 3000 },
                },
            },
            frogger: {
                scrub: false,
                batch: { maxSize: 200, maxAge: 15000, sortingWindowMs: 3000 },
                websocket: false,
                transports: [memoryEntry(name)],
            },
        })
    }

    it('delivers logs younger than the sorting window that flush() holds back', async () => {
        clearCapturedLogs('drain')
        setBatchedConfig('drain')
        const queue = freshQueue()

        // A crash line is milliseconds old; flush() defers it to sort stragglers.
        queue.enqueueLog(makeLog({ msg: 'fatal crash line', time: Date.now() }))

        await queue.flush()
        expect(getCapturedLogs({ name: 'drain' })).toHaveLength(0)

        await queue.drain()
        expect(getCapturedLogs({ name: 'drain' }).map(l => l.msg)).toEqual(['fatal crash line'])
    })

    it('falls back to flush() in direct (unbatched) mode', async () => {
        clearCapturedLogs('direct-drain')
        setConfig([memoryEntry('direct-drain')], { batch: false })
        const queue = freshQueue()

        queue.enqueueLog(makeLog({ msg: 'row' }))
        await queue.drain()

        expect(getCapturedLogs({ name: 'direct-drain' }).map(l => l.msg)).toEqual(['row'])
    })

    it('is safe on an empty queue and an uninitialised service', async () => {
        setBatchedConfig('empty-drain')
        const queue = freshQueue()
        await expect(queue.drain()).resolves.toBeUndefined()
    })
})
