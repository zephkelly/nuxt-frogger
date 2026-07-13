// @vitest-environment nuxt
import { describe, it, expect, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

const { useRuntimeConfigMock, useNuxtAppMock } = vi.hoisted(() => ({
    useNuxtAppMock: vi.fn(() => ({})),
    useRuntimeConfigMock: vi.fn(() => ({
        frogger: { file: false, batch: false },
        public: {
            frogger: {
                serverModule: true,
                app: 'test-app',
                // Empty endpoint short-circuits the network send, so logs are
                // observed purely via a custom reporter.
                endpoint: '',
                baseUrl: '',
                batch: false,
                scrub: false,
            },
        },
    })),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)
mockNuxtImport('useState', () => <T>(_key: string, init?: () => T) => ref(init ? init() : undefined))

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog: vi.fn(), flush: vi.fn() }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'

// Consola dispatches to reporters without awaiting; flush before asserting.
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

// Reporters observe exactly what a transport would receive, i.e. the emitted
// LoggerObject with the logger's global context already folded into `ctx`.
function capture(logger: IFroggerLogger): LoggerObject[] {
    const logs: LoggerObject[] = []
    logger.addReporter({ log: (obj: LoggerObject) => { logs.push(obj) } })
    return logs
}

describe('addContext merge precedence (ServerFroggerLogger)', () => {
    it('incoming wins by default, so a re-stamped key updates instead of freezing', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })
        const logs = capture(logger)

        logger.addContext({ route: '/login' })
        logger.addContext({ route: '/dashboard' })
        logger.info('nav')
        await flush()

        expect(logs[0]!.ctx.route).toBe('/dashboard')
    })

    it('preserves unrelated keys while updating the stamped one', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })
        const logs = capture(logger)

        logger.addContext({ user: 'u_1' })
        logger.addContext({ route: '/a' })
        logger.addContext({ route: '/b' })
        logger.info('nav')
        await flush()

        expect(logs[0]!.ctx.user).toBe('u_1')
        expect(logs[0]!.ctx.route).toBe('/b')
    })

    it('overwrite: false keeps existing values and only fills missing keys', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })
        const logs = capture(logger)

        logger.addContext({ tenant: 'acme' })
        logger.addContext({ tenant: 'other', region: 'eu' }, { overwrite: false })
        logger.info('x')
        await flush()

        expect(logs[0]!.ctx.tenant).toBe('acme')
        expect(logs[0]!.ctx.region).toBe('eu')
    })

    it('deep-merges nested objects regardless of precedence mode', async () => {
        const logger = new ServerFroggerLogger({ consoleOutput: false })
        const logs = capture(logger)

        logger.addContext({ meta: { a: 1 } })
        logger.addContext({ meta: { b: 2 } })
        logger.info('deep')
        await flush()

        expect(logs[0]!.ctx.meta).toEqual({ a: 1, b: 2 })
    })
})
