// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

type Level = string | { client?: string; server?: string } | undefined

const { useRuntimeConfigMock, configState, enqueueLog } = vi.hoisted(() => {
    const configState = { level: undefined as Level }
    return {
        configState,
        enqueueLog: vi.fn(),
        useRuntimeConfigMock: vi.fn(() => ({
            frogger: { batch: false, scrub: false, transports: [] },
            public: {
                frogger: {
                    serverModule: true,
                    app: 'test-app',
                    endpoint: '',
                    baseUrl: '',
                    batch: false,
                    scrub: false,
                    consoleOutput: false,
                    level: configState.level,
                },
            },
        })),
    }
})

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog, flush: vi.fn() }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const emitted = (): LoggerObject[] => enqueueLog.mock.calls.map(c => c[0] as LoggerObject)

beforeEach(() => {
    configState.level = undefined
    enqueueLog.mockClear()
})

const ALL_METHODS = [
    'fatal', 'error', 'warn', 'log', 'info', 'success', 'fail',
    'ready', 'start', 'debug', 'trace', 'silent', 'verbose',
] as const

describe('log level thresholds', () => {
    it('defaults to info, so debug and trace are dropped', async () => {
        const logger = new ServerFroggerLogger({})
        logger.info('kept')
        logger.debug('dropped')
        logger.trace('dropped')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['kept'])
    })

    it('level:debug makes frogger.debug() reach the pipeline', async () => {
        // Before this option existed there was no way to enable debug at all.
        configState.level = 'debug'
        const logger = new ServerFroggerLogger({})
        logger.debug('now visible')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['now visible'])
    })

    it('level:trace admits everything down to trace', async () => {
        configState.level = 'trace'
        const logger = new ServerFroggerLogger({})
        logger.trace('deepest')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['deepest'])
    })

    it('level:warn suppresses info as well', async () => {
        configState.level = 'warn'
        const logger = new ServerFroggerLogger({})
        logger.info('dropped')
        logger.warn('kept')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['kept'])
    })

    it('reads the server side of a per-runtime level object', async () => {
        configState.level = { client: 'error', server: 'debug' }
        const logger = new ServerFroggerLogger({})
        logger.debug('server debug')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['server debug'])
    })

    it('a per-logger level overrides the module level', async () => {
        configState.level = 'error'
        const logger = new ServerFroggerLogger({ level: 'debug' })
        logger.debug('per-logger')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['per-logger'])
    })

    it('still accepts a raw number as the low-level escape hatch', async () => {
        const logger = new ServerFroggerLogger({ level: 5 })
        logger.trace('numeric')
        await flush()

        expect(emitted().map(l => l.msg)).toEqual(['numeric'])
    })
})

describe('severity table', () => {
    it('emits a finite, JSON-safe lvl for every level method', async () => {
        // consola assigns silent -Infinity and verbose +Infinity, both of which
        // JSON.stringify turns into null. `lvl` is derived from `type` instead.
        const logger = new ServerFroggerLogger({ level: 5 })
        for (const method of ALL_METHODS) {
            ;(logger as unknown as Record<string, (m: string) => void>)[method]!(method)
        }
        await flush()

        const rows = emitted()
        expect(rows.length).toBeGreaterThan(0)

        for (const row of rows) {
            const roundTripped = JSON.parse(JSON.stringify(row)) as LoggerObject
            expect(Number.isFinite(roundTripped.lvl)).toBe(true)
            expect(Number.isFinite(roundTripped.sev)).toBe(true)
        }
    })

    it('carries the OTel SeverityNumber alongside frogger levels', async () => {
        const logger = new ServerFroggerLogger({ level: 5 })
        logger.error('e')
        logger.warn('w')
        logger.info('i')
        logger.debug('d')
        logger.trace('t')
        await flush()

        const bySeverity = Object.fromEntries(emitted().map(l => [l.msg, l.sev]))
        expect(bySeverity).toEqual({ t: 1, d: 5, i: 9, w: 13, e: 17 })
    })

    it('orders sev by seriousness and lvl by verbosity, in opposite directions', async () => {
        const logger = new ServerFroggerLogger({ level: 5 })
        logger.error('serious')
        logger.trace('noisy')
        await flush()

        const [serious, noisy] = emitted()
        expect(serious!.sev).toBeGreaterThan(noisy!.sev)
        expect(serious!.lvl).toBeLessThan(noisy!.lvl)
    })
})
