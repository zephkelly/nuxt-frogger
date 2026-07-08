// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

const { useRuntimeConfigMock, queueLogs } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(() => ({
        frogger: { file: false, batch: false, scrub: false },
        public: { frogger: { scrub: false, batch: false, endpoint: '/ingest' } },
    })),
    // Child loggers do not inherit custom reporters, but every server logger
    // funnels into the shared queue singleton — capture there.
    queueLogs: [] as unknown[],
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({
            enqueueLog: (obj: unknown) => { queueLogs.push(obj) },
            flush: vi.fn(),
        }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'
import { getActiveLogger } from '../../src/runtime/logger/active-context.server'

// Consola dispatches to reporters without awaiting, so captured logs land a
// microtask later; flush before asserting.
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe('span parentage (ServerFroggerLogger)', () => {
    let logs: LoggerObject[]
    let root: ServerFroggerLogger

    beforeEach(() => {
        queueLogs.length = 0
        logs = queueLogs as LoggerObject[]
        root = new ServerFroggerLogger({ consoleOutput: false })
    })

    it('startSpan child chains under the parent logger\'s current span', async () => {
        root.info('r1')
        await flush()

        const child = root.startSpan('checkout')
        child.info('c1')
        await flush()

        expect(logs).toHaveLength(2)
        const [r1, c1] = logs
        expect(c1!.trace.traceId).toBe(r1!.trace.traceId)
        expect(c1!.trace.parentId).toBe(r1!.trace.spanId)
        expect(c1!.ctx.span).toBe('checkout')
    })

    it('startSpan merges extra options with the span name context', async () => {
        const child = root.startSpan('checkout', { context: { orderId: 'o-1' } })
        child.info('c1')
        await flush()

        expect(logs[0]!.ctx.span).toBe('checkout')
        expect(logs[0]!.ctx.orderId).toBe('o-1')
    })

    it('span() installs the span child as the active logger, restores on exit, and propagates the return value', async () => {
        root.info('r1')
        await flush()

        let inside: IFroggerLogger | undefined
        const result = await root.span('outer', async () => {
            inside = getActiveLogger()
            inside!.info('a1')
            return 42
        })

        expect(result).toBe(42)
        expect(inside).toBeDefined()
        expect(getActiveLogger()).toBeUndefined()

        await flush()
        expect(logs).toHaveLength(2)
        const [r1, a1] = logs
        expect(a1!.trace.traceId).toBe(r1!.trace.traceId)
        expect(a1!.trace.parentId).toBe(r1!.trace.spanId)
        expect(a1!.ctx.span).toBe('outer')
    })

    it('a nested span produces a deeper parentId on the same trace', async () => {
        root.info('r1')
        await flush()

        await root.span('outer', async () => {
            const outer = getActiveLogger()!
            outer.info('a1')
            await flush()

            await outer.span('inner', async () => {
                getActiveLogger()!.info('b1')
            })
        })
        await flush()

        expect(logs).toHaveLength(3)
        const [r1, a1, b1] = logs
        expect(a1!.trace.traceId).toBe(r1!.trace.traceId)
        expect(b1!.trace.traceId).toBe(r1!.trace.traceId)
        expect(a1!.trace.parentId).toBe(r1!.trace.spanId)
        expect(b1!.trace.parentId).toBe(a1!.trace.spanId)
        expect(b1!.ctx.span).toBe('inner')
    })

    it('a nested span opened before any intermediate log stays on the same trace', async () => {
        root.info('r1')
        await flush()

        await root.span('outer', async () => {
            await getActiveLogger()!.span('inner', async () => {
                getActiveLogger()!.info('b1')
            })
        })
        await flush()

        expect(logs).toHaveLength(2)
        const [r1, b1] = logs
        expect(b1!.trace.traceId).toBe(r1!.trace.traceId)
        // Neither span logged before b1, so the closest logged ancestor is r1.
        expect(b1!.trace.parentId).toBe(r1!.trace.spanId)
        expect(b1!.ctx.span).toBe('inner')
    })

    it('sibling logs inside a span advance the span child\'s own chain', async () => {
        await root.span('outer', async () => {
            const active = getActiveLogger()!
            active.info('a1')
            await flush()
            active.info('a2')
        })
        await flush()

        expect(logs).toHaveLength(2)
        const [a1, a2] = logs
        expect(a2!.trace.traceId).toBe(a1!.trace.traceId)
        expect(a2!.trace.parentId).toBe(a1!.trace.spanId)
    })

    it('concurrent spans on the same root are isolated by AsyncLocalStorage', async () => {
        await Promise.all([
            root.span('span-a', async () => {
                await sleep(15)
                getActiveLogger()!.info('in-a')
            }),
            root.span('span-b', async () => {
                await sleep(5)
                getActiveLogger()!.info('in-b')
            }),
        ])
        await flush()

        const inA = logs.find(l => l.msg === 'in-a')
        const inB = logs.find(l => l.msg === 'in-b')
        expect(inA!.ctx.span).toBe('span-a')
        expect(inB!.ctx.span).toBe('span-b')
        expect(inA!.trace.traceId).toBe(inB!.trace.traceId)
    })
})
