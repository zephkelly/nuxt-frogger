// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

const { useRuntimeConfigMock, useNuxtAppMock, configState } = vi.hoisted(() => {
    const configState = { scrub: false as unknown }
    return {
        configState,
        useNuxtAppMock: vi.fn(() => ({})),
        useRuntimeConfigMock: vi.fn(() => ({
            frogger: { file: false, batch: false },
            public: {
                frogger: {
                    serverModule: true,
                    app: 'test-app',
                    // Empty endpoint short-circuits the client's network send,
                    // so tests observe logs purely via custom reporters.
                    endpoint: '',
                    baseUrl: '',
                    batch: false,
                    scrub: configState.scrub,
                },
            },
        })),
    }
})

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)
mockNuxtImport('useState', () => <T>(_key: string, init?: () => T) => ref(init ? init() : undefined))

const { enqueueLogMock } = vi.hoisted(() => ({ enqueueLogMock: vi.fn() }))

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog: enqueueLogMock, flush: vi.fn() }),
    },
}))

// getFrogger falls back to useEvent() when no event is passed. The real one
// THROWS outside a request context (boot-time nitro plugins, cron tasks) —
// the mock does the same so options-only calls exercise getFrogger's guard.
// The 0.1.22 crash: the global-error plugin's getFrogger({ context }) call
// stopped being mistaken for an event and hit this throw at startup.
vi.mock('nitropack/runtime/internal/context', () => ({
    useEvent: vi.fn(() => {
        throw new Error('Nitro request context is not available.')
    }),
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'
import { ClientFrogger } from '../../src/runtime/logger/client'
import { getFrogger } from '../../src/runtime/server/utils/manual'
import { defineScrub } from '../../src/runtime/scrubber/builder'
import { SCRUB_HANDLED } from '../../src/runtime/shared/types/log'

// Consola dispatches to reporters without awaiting; flush before asserting.
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

// Reporters run after the scrubber in handleLog, so they observe exactly what
// a transport would receive.
function capture(logger: IFroggerLogger): LoggerObject[] {
    const logs: LoggerObject[] = []
    logger.addReporter({ log: (obj: LoggerObject) => { logs.push(obj) } })
    return logs
}

const MODULE_SCRUB = defineScrub().redact('password').build()

beforeEach(() => {
    configState.scrub = MODULE_SCRUB
    enqueueLogMock.mockClear()
})

describe('per-logger scrub option (ServerFroggerLogger)', () => {
    it('module scrub applies by default', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })
        const logs = capture(logger)

        logger.info('msg', { password: 'hunter2', user: 'zeph' })
        await flush()

        expect(logs[0]!.ctx.password).toBe('[REDACTED]')
        expect(logs[0]!.ctx.user).toBe('zeph')
    })

    it('scrub: false disables scrubbing even when module scrub is on', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false, scrub: false })
        const logs = capture(logger)

        logger.info('msg', { password: 'hunter2' })
        await flush()

        expect(logs[0]!.ctx.password).toBe('hunter2')
    })

    it('a per-logger scrub object replaces module rules entirely', async () => {
        const logger = new ServerFroggerLogger({
            consoleOutput: false,
            scrub: defineScrub().redact('apiKey').build(),
        })
        const logs = capture(logger)

        logger.info('msg', { password: 'hunter2', apiKey: 'sk-123' })
        await flush()

        expect(logs[0]!.ctx.apiKey).toBe('[REDACTED]')
        // The module's password rule must NOT leak into the replacement config.
        expect(logs[0]!.ctx.password).toBe('hunter2')
    })

    it('child({ scrub: false }) opts the child out while the parent keeps scrubbing', async () => {
        const parent = new ServerFroggerLogger({ consoleOutput: false })
        const parentLogs = capture(parent)

        const child = parent.child({ scrub: false })
        const childLogs = capture(child)

        parent.info('p', { password: 'hunter2' })
        child.info('c', { password: 'hunter2' })
        await flush()

        expect(parentLogs[0]!.ctx.password).toBe('[REDACTED]')
        expect(childLogs[0]!.ctx.password).toBe('hunter2')
    })

    it('a child scrub object replaces the parent config instead of merging rules', async () => {
        const parent = new ServerFroggerLogger({ consoleOutput: false, scrub: MODULE_SCRUB })
        const child = parent.child({ scrub: defineScrub().redact('apiKey').build() })
        const childLogs = capture(child)

        child.info('c', { password: 'hunter2', apiKey: 'sk-123' })
        await flush()

        expect(childLogs[0]!.ctx.apiKey).toBe('[REDACTED]')
        expect(childLogs[0]!.ctx.password).toBe('hunter2')
    })

    it('a grandchild inherits the child\'s scrub: false', async () => {
        const parent = new ServerFroggerLogger({ consoleOutput: false })
        const grandchild = parent.child({ scrub: false }).child({})
        const logs = capture(grandchild)

        grandchild.info('g', { password: 'hunter2' })
        await flush()

        expect(logs[0]!.ctx.password).toBe('hunter2')
    })

    it('startSpan passes scrub through to the span child', async () => {
        const parent = new ServerFroggerLogger({ consoleOutput: false })
        const span = parent.startSpan('job', { scrub: false })
        const logs = capture(span)

        span.info('s', { password: 'hunter2' })
        await flush()

        expect(logs[0]!.ctx.password).toBe('hunter2')
        expect(logs[0]!.ctx.span).toBe('job')
    })
})

describe('per-logger scrub option (ClientFrogger)', () => {
    it('child({ scrub: false }) overrides the root\'s config-populated options', async () => {
        const parent = new ClientFrogger(ref(true), { consoleOutput: false })
        const parentLogs = capture(parent)

        const child = parent.child({ scrub: false })
        const childLogs = capture(child)

        parent.info('p', { password: 'hunter2' })
        child.info('c', { password: 'hunter2' })
        await flush()

        expect(parentLogs[0]!.ctx.password).toBe('[REDACTED]')
        expect(childLogs[0]!.ctx.password).toBe('hunter2')
    })

    it('useFrogger-style root options accept a scrub object that replaces module rules', async () => {
        const logger = new ClientFrogger(ref(true), {
            consoleOutput: false,
            scrub: defineScrub().redact('apiKey').build(),
        })
        const logs = capture(logger)

        logger.info('msg', { password: 'hunter2', apiKey: 'sk-123' })
        await flush()

        expect(logs[0]!.ctx.apiKey).toBe('[REDACTED]')
        expect(logs[0]!.ctx.password).toBe('hunter2')
    })

    it('child options override parent defaults generally (level was previously locked)', async () => {
        const parent = new ClientFrogger(ref(true), { consoleOutput: false })
        const parentLogs = capture(parent)

        const child = parent.child({ level: 4 })
        const childLogs = capture(child)

        parent.debug('p-debug')
        child.debug('c-debug')
        await flush()

        expect(parentLogs).toHaveLength(0)
        expect(childLogs).toHaveLength(1)
    })
})

describe('getFrogger option precedence', () => {
    it('caller options override runtime config, matching the JSDoc', () => {
        const fakeEvent = { __is_event__: true, context: {} } as never

        const logger = getFrogger(fakeEvent, { scrub: false, endpoint: '/custom' } as never)
        const options = (logger as unknown as { options: Record<string, unknown> }).options

        expect(options.endpoint).toBe('/custom')
        expect(options.scrub).toBe(false)
    })
})

describe('getFrogger event detection', () => {
    function optionsOf(logger: unknown): Record<string, unknown> {
        return (logger as { options: Record<string, unknown> }).options
    }

    it('an options object carrying a `context` key is not mistaken for an event', () => {
        // The old `'context' in x` sniff treated this exact shape as an H3Event
        // and silently dropped scrub: false.
        const logger = getFrogger({ context: { op: 'sync' }, scrub: false } as never)
        const options = optionsOf(logger)

        expect(options.scrub).toBe(false)
        expect(options.context).toEqual({ op: 'sync' })
    })

    it('a real event is recognised by its h3 brand, not a colliding property', () => {
        const fakeEvent = { __is_event__: true, context: {} } as never

        const logger = getFrogger(fakeEvent, { scrub: false } as never)

        expect(optionsOf(logger).scrub).toBe(false)
    })

    it('does not throw at boot time, when useEvent has no request context', () => {
        // The global-error nitro plugin calls this exact shape during
        // runNitroPlugins, before any request exists.
        const logger = getFrogger({ context: { errorHandler: 'global' } } as never)

        expect(optionsOf(logger).context).toEqual({ errorHandler: 'global' })
    })

    it('accepts the event in second position, per the auto overload order', () => {
        const fakeEvent = { __is_event__: true, context: {} } as never

        const logger = getFrogger({ scrub: false } as never, fakeEvent)

        expect(optionsOf(logger).scrub).toBe(false)
    })
})

describe('scrub-handled stamp (ServerFroggerLogger -> queue)', () => {
    async function lastEnqueued(): Promise<LoggerObject> {
        await flush()
        expect(enqueueLogMock).toHaveBeenCalled()
        return enqueueLogMock.mock.calls.at(-1)![0] as LoggerObject
    }

    it('stamps rows so the queue skips its module-level pass (scrub: false survives)', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false, scrub: false })

        logger.info('msg', { password: 'hunter2' })
        const row = await lastEnqueued()

        expect(row[SCRUB_HANDLED]).toBe(true)
        expect(row.ctx.password).toBe('hunter2')
    })

    it('stamps scrubbed rows too: the logger pass already applied the rules', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })

        logger.info('msg', { password: 'hunter2' })
        const row = await lastEnqueued()

        expect(row[SCRUB_HANDLED]).toBe(true)
        expect(row.ctx.password).toBe('[REDACTED]')
    })
})
