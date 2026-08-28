// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

const { useRuntimeConfigMock, enqueueLog } = vi.hoisted(() => ({
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
                consoleOutput: false,
                // A rule that would redact `user` if the field were scrubbable.
                scrub: {
                    deepScrub: true,
                    rules: [{ action: 'redact', fieldPatterns: ['user', 'email'], priority: 100 }],
                },
            },
        },
    })),
}))

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
    enqueueLog.mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('frogger.identify()', () => {
    it('stamps the user as a top-level field on every subsequent row', async () => {
        const logger = new ServerFroggerLogger({})

        logger.info('before')
        logger.identify('user-42')
        logger.info('after')
        await flush()

        const [before, after] = emitted()
        expect(before!.user).toBeUndefined()
        expect(after!.user).toBe('user-42')
    })

    it('never scrubs the user field, even under a rule that names it', async () => {
        // `user` is an index key, not user-supplied content. Redacting it would
        // break every join a reader can do while protecting nothing.
        const logger = new ServerFroggerLogger({})

        logger.identify('user-42')
        logger.info('hello')
        await flush()

        expect(emitted()[0]!.user).toBe('user-42')
    })

    it('puts extra properties in ctx, where they ARE scrubbed', async () => {
        const logger = new ServerFroggerLogger({})

        logger.identify({ id: 'user-42', email: 'a@b.test' })
        logger.info('hello')
        await flush()

        const row = emitted()[0]!
        expect(row.user).toBe('user-42')
        expect(row.ctx.user?.email).not.toBe('a@b.test')
    })

    it('clears the user on sign-out', async () => {
        const logger = new ServerFroggerLogger({})

        logger.identify('user-42')
        logger.identify(null)
        logger.info('after-signout')
        await flush()

        expect(emitted()[0]!.user).toBeUndefined()
    })

    it('passes the identity down to children and spans', async () => {
        const logger = new ServerFroggerLogger({})
        logger.identify('user-42')

        await logger.span('checkout', async () => {})
        const child = logger.child({})
        child.info('from-child')
        await flush()

        for (const row of emitted()) {
            expect(row.user).toBe('user-42')
        }
    })

    it('does not leak a child identity back onto the parent', async () => {
        // Server-side identity is request-scoped; a span identifying someone
        // must not rewrite the enclosing request's user.
        const logger = new ServerFroggerLogger({})
        logger.identify('parent-user')

        const child = logger.child({})
        child.identify('child-user')

        child.info('from-child')
        logger.info('from-parent')
        await flush()

        const rows = emitted()
        expect(rows.find(r => r.msg === 'from-child')!.user).toBe('child-user')
        expect(rows.find(r => r.msg === 'from-parent')!.user).toBe('parent-user')
    })

    it('stamps the route pattern as a top-level field', async () => {
        const logger = new ServerFroggerLogger({})
        ;(logger as unknown as { setRoute(r: string): void }).setRoute('/orders/[id]')

        logger.info('hello')
        await flush()

        expect(emitted()[0]!.route).toBe('/orders/[id]')
    })

    it('stamps the session as a top-level field', async () => {
        const logger = new ServerFroggerLogger({})
        ;(logger as unknown as { setSession(s: unknown): void })
            .setSession({ id: 'sess-1', sampled: true })

        logger.info('hello')
        await flush()

        expect(emitted()[0]!.session).toEqual({ id: 'sess-1', sampled: true })
    })
})
