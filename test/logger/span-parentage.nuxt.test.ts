// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

const { useRuntimeConfigMock, queueLogs, publicFroggerConfig } = vi.hoisted(() => {
    const publicFroggerConfig: Record<string, unknown> = { scrub: false, batch: false, endpoint: '/ingest' }
    return {
        publicFroggerConfig,
        useRuntimeConfigMock: vi.fn(() => ({
            frogger: { file: false, batch: false, scrub: false },
            public: { frogger: publicFroggerConfig },
        })),
        // Child loggers do not inherit custom reporters, but every server logger
        // funnels into the shared queue singleton — capture there.
        queueLogs: [] as unknown[],
    }
})

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
import { parseTraceparent } from '../../src/runtime/shared/utils/trace-headers'

// Consola dispatches to reporters without awaiting, so captured logs land a
// microtask later; flush before asserting.
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe('span parentage (ServerFroggerLogger)', () => {
    let allLogs: LoggerObject[]
    let logs: LoggerObject[]
    let root: ServerFroggerLogger

    beforeEach(() => {
        queueLogs.length = 0
        allLogs = queueLogs as LoggerObject[]
        root = new ServerFroggerLogger({ consoleOutput: false })
    })

    // Parentage assertions run over application rows; span() additionally
    // emits one end event per span, asserted in its own describe below.
    function appLogs(): LoggerObject[] {
        return allLogs.filter(l => l.ctx.spanEvent !== 'end')
    }

    it('startSpan child chains under the parent logger\'s current span', async () => {
        root.info('r1')
        await flush()

        const child = root.startSpan('checkout')
        child.info('c1')
        await flush()

        logs = appLogs()
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

        logs = appLogs()
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
        logs = appLogs()
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

        logs = appLogs()
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

        logs = appLogs()
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

        logs = appLogs()
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

        logs = appLogs()
        const inA = logs.find(l => l.msg === 'in-a')
        const inB = logs.find(l => l.msg === 'in-b')
        expect(inA!.ctx.span).toBe('span-a')
        expect(inB!.ctx.span).toBe('span-b')
        expect(inA!.trace.traceId).toBe(inB!.trace.traceId)
    })
})

describe('span end events (ServerFroggerLogger)', () => {
    let root: ServerFroggerLogger

    beforeEach(() => {
        queueLogs.length = 0
        delete publicFroggerConfig.spans
        root = new ServerFroggerLogger({ consoleOutput: false })
    })

    function endEvents(): LoggerObject[] {
        return (queueLogs as LoggerObject[]).filter(l => l.ctx.spanEvent === 'end')
    }

    it('a span emits exactly one end event carrying duration and ok', async () => {
        await root.span('checkout', async () => {
            getActiveLogger()!.info('inside')
        })
        await flush()

        const events = endEvents()
        expect(events).toHaveLength(1)
        const [end] = events
        expect(end!.msg).toBe('checkout')
        expect(end!.ctx.span).toBe('checkout')
        expect(end!.ctx.ok).toBe(true)
        expect(typeof end!.ctx.durationMs).toBe('number')
        expect(end!.type).toBe('info')
    })

    it('a span whose body has no logs is still visible through its end event', async () => {
        await root.span('quiet', async () => {})
        await flush()

        expect(endEvents()).toHaveLength(1)
    })

    it('a throwing span emits ok: false and rethrows', async () => {
        await expect(root.span('explode', async () => {
            throw new Error('boom')
        })).rejects.toThrow('boom')
        await flush()

        const events = endEvents()
        expect(events).toHaveLength(1)
        expect(events[0]!.ctx.ok).toBe(false)
        // The error itself is the caller's to report; the event carries status only.
        expect(events[0]!.ctx.error).toBeUndefined()
    })

    it('spans: false disables end events entirely', async () => {
        publicFroggerConfig.spans = false
        const silentRoot = new ServerFroggerLogger({ consoleOutput: false })

        await silentRoot.span('quiet', async () => {})
        await flush()

        expect(queueLogs).toHaveLength(0)
    })

    it('a configured level is honoured', async () => {
        publicFroggerConfig.spans = { level: 'debug' }
        const debugRoot = new ServerFroggerLogger({ consoleOutput: false, level: 4 })

        await debugRoot.span('quiet', async () => {})
        await flush()

        const events = endEvents()
        expect(events).toHaveLength(1)
        expect(events[0]!.type).toBe('debug')
    })
})

describe('outgoing trace headers (getHeaders)', () => {
    let allLogs: LoggerObject[]
    let root: ServerFroggerLogger

    beforeEach(() => {
        queueLogs.length = 0
        allLogs = queueLogs as LoggerObject[]
        root = new ServerFroggerLogger({ consoleOutput: false })
    })

    function parentIdOf(logger: IFroggerLogger): string {
        const parsed = parseTraceparent(logger.getHeaders().traceparent!)
        return parsed!.spanId!
    }

    function appLogs(): LoggerObject[] {
        return allLogs.filter(l => l.ctx.spanEvent !== 'end')
    }

    it('advertises the last emitted row once the logger has logged', async () => {
        root.info('r1')
        await flush()

        expect(parentIdOf(root)).toBe(appLogs()[0]!.trace.spanId)
    })

    it('advertises an id the first row then uses, when called before any log', async () => {
        const child = root.startSpan('checkout')
        const advertised = parentIdOf(child)

        child.info('c1')
        await flush()

        expect(appLogs()[0]!.trace.spanId).toBe(advertised)
    })

    it('does not advertise the parent row, which would make the call a sibling', async () => {
        root.info('r1')
        await flush()
        const rootSpanId = appLogs()[0]!.trace.spanId

        const child = root.startSpan('checkout')

        expect(parentIdOf(child)).not.toBe(rootSpanId)
    })

    it('keeps the reservation stable across repeated calls before the first log', () => {
        const child = root.startSpan('checkout')

        expect(parentIdOf(child)).toBe(parentIdOf(child))
    })

    it('reserves once, then follows the chain for later rows', async () => {
        const child = root.startSpan('checkout')
        const advertised = parentIdOf(child)

        child.info('c1')
        child.info('c2')
        await flush()

        const logs = appLogs()
        expect(logs[0]!.trace.spanId).toBe(advertised)
        expect(logs[1]!.trace.spanId).not.toBe(advertised)
        expect(logs[1]!.trace.parentId).toBe(advertised)
        expect(parentIdOf(child)).toBe(logs[1]!.trace.spanId)
    })

    it('still parents the span child under the parent row', async () => {
        root.info('r1')
        await flush()
        const rootSpanId = appLogs()[0]!.trace.spanId

        const child = root.startSpan('checkout')
        parentIdOf(child)
        child.info('c1')
        await flush()

        expect(appLogs()[1]!.trace.parentId).toBe(rootSpanId)
    })

    it("a fresh root logger's advertised id materialises on its first row", async () => {
        const advertised = parentIdOf(root)

        root.info('r1')
        await flush()

        expect(appLogs()[0]!.trace.spanId).toBe(advertised)
    })

    it('carries the logger trace id, not a new one', () => {
        const child = root.startSpan('checkout')
        const parsed = parseTraceparent(child.getHeaders().traceparent!)

        expect(parsed!.traceId).toBe(parseTraceparent(root.getHeaders().traceparent!)!.traceId)
    })

    it('reset() drops a reservation rather than advertising it on a new trace', async () => {
        const advertised = parentIdOf(root)
        root.reset()

        root.info('r1')
        await flush()

        expect(appLogs()[0]!.trace.spanId).not.toBe(advertised)
    })
})
