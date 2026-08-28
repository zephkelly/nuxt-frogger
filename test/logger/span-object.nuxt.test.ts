// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { SpanObject } from '../../src/runtime/shared/types/span'
import { mergeSpanStatus, boundSpanAttributes, MAX_SPAN_ATTRIBUTES } from '../../src/runtime/shared/types/span'

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
                scrub: false,
                consoleOutput: false,
                spans: false,
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
import { setSpanSink } from '../../src/runtime/shared/utils/span-sink'

let spans: SpanObject[]

beforeEach(() => {
    spans = []
    enqueueLog.mockClear()
    setSpanSink(span => spans.push(span))
})

afterEach(() => {
    setSpanSink(null)
})

describe('SpanObject emission', () => {
    it('emits a span record even with span-end log rows disabled', async () => {
        // `spans: false` is about LOG VOLUME, not about whether the span
        // happened. Before, a silent span left no trace anywhere.
        const logger = new ServerFroggerLogger({})

        await logger.span('checkout', async () => {})

        expect(enqueueLog).not.toHaveBeenCalled()
        expect(spans).toHaveLength(1)
        expect(spans[0]!.name).toBe('checkout')
    })

    it('carries a real start timestamp rather than only a duration', async () => {
        const logger = new ServerFroggerLogger({})
        const before = Date.now()

        await logger.span('work', async () => {})

        const span = spans[0]!
        expect(span.startTime).toBeGreaterThanOrEqual(before)
        expect(span.endTime).toBeGreaterThanOrEqual(span.startTime)
    })

    it('records an error status with the thrown message', async () => {
        const logger = new ServerFroggerLogger({})

        await expect(logger.span('failing', async () => {
            throw new Error('payment declined')
        })).rejects.toThrow('payment declined')

        expect(spans[0]!.status).toEqual({ code: 'error', message: 'payment declined' })
    })

    it('records ok for a span that completed', async () => {
        const logger = new ServerFroggerLogger({})
        await logger.span('fine', async () => {})
        expect(spans[0]!.status.code).toBe('ok')
    })

    it('builds a real parent tree across nested spans', async () => {
        const logger = new ServerFroggerLogger({})

        await logger.span('outer', async () => {
            const outer = (await import('../../src/runtime/logger/active-context.server')).getActiveLogger()!
            await outer.span('inner', async () => {})
        })

        const outer = spans.find(s => s.name === 'outer')!
        const inner = spans.find(s => s.name === 'inner')!

        expect(inner.parentSpanId).toBe(outer.spanId)
        expect(inner.traceId).toBe(outer.traceId)
    })

    it('carries the span kind when one is declared', async () => {
        const logger = new ServerFroggerLogger({})
        await logger.span('handle-request', async () => {}, { kind: 'server' })
        expect(spans[0]!.kind).toBe('server')
    })

    it('defaults to internal', async () => {
        const logger = new ServerFroggerLogger({})
        await logger.span('work', async () => {})
        expect(spans[0]!.kind).toBe('internal')
    })

    it('carries span-scoped attributes set on the handle', async () => {
        const logger = new ServerFroggerLogger({})

        await logger.span('checkout', async () => {
            const active = (await import('../../src/runtime/logger/active-context.server')).getActiveLogger()!
            active.setAttribute('cart.items', 3)
        })

        expect(spans[0]!.attributes).toMatchObject({ 'cart.items': 3 })
    })

    it('gives every span a uuidv7 id', async () => {
        const logger = new ServerFroggerLogger({})
        await logger.span('work', async () => {})
        expect(spans[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    })

    it('does nothing when no sink is registered', async () => {
        setSpanSink(null)
        const logger = new ServerFroggerLogger({})

        await expect(logger.span('work', async () => 'result')).resolves.toBe('result')
        expect(spans).toHaveLength(0)
    })
})

describe('span status total order', () => {
    it('does not let a later ok downgrade an error', () => {
        // A handler that swallows a failure at the end of a span must not erase
        // the fact that the span failed.
        expect(mergeSpanStatus({ code: 'error' }, { code: 'ok' })).toEqual({ code: 'error' })
    })

    it('lets ok replace unset', () => {
        expect(mergeSpanStatus({ code: 'unset' }, { code: 'ok' })).toEqual({ code: 'ok' })
    })

    it('ignores an unset update', () => {
        expect(mergeSpanStatus({ code: 'ok' }, { code: 'unset' })).toEqual({ code: 'ok' })
    })
})

describe('span attribute bounds', () => {
    it('caps the number of attributes so a span cannot become a payload', () => {
        const many = Object.fromEntries(
            Array.from({ length: MAX_SPAN_ATTRIBUTES + 20 }, (_, i) => [`k${i}`, i]),
        )
        expect(Object.keys(boundSpanAttributes(many)!)).toHaveLength(MAX_SPAN_ATTRIBUTES)
    })

    it('truncates an oversized string value', () => {
        const bounded = boundSpanAttributes({ big: 'x'.repeat(5000) })!
        expect((bounded.big as string).length).toBeLessThan(5000)
        expect(bounded.big as string).toMatch(/…$/)
    })

    it('drops non-scalar values rather than serialising them', () => {
        expect(boundSpanAttributes({ obj: { a: 1 }, ok: true })).toEqual({ ok: true })
    })

    it('returns undefined when nothing survives', () => {
        expect(boundSpanAttributes({ obj: { a: 1 } })).toBeUndefined()
        expect(boundSpanAttributes(undefined)).toBeUndefined()
    })
})
