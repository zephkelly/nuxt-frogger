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

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog: vi.fn(), flush: vi.fn() }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'
import { ClientFrogger } from '../../src/runtime/logger/client'
import { getFrogger } from '../../src/runtime/server/utils/manual'
import { defineScrub } from '../../src/runtime/scrubber/builder'

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
        const fakeEvent = { context: {} } as never

        const logger = getFrogger(fakeEvent, { scrub: false, endpoint: '/custom' } as never)
        const options = (logger as unknown as { options: Record<string, unknown> }).options

        expect(options.endpoint).toBe('/custom')
        expect(options.scrub).toBe(false)
    })
})
