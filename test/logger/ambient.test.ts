import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAmbientFrogger } from '../../src/runtime/logger/ambient'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

function createMockLogger() {
    return {
        error: vi.fn(), fatal: vi.fn(), warn: vi.fn(), log: vi.fn(),
        info: vi.fn(), success: vi.fn(), fail: vi.fn(), ready: vi.fn(),
        start: vi.fn(), debug: vi.fn(), trace: vi.fn(), silent: vi.fn(),
        verbose: vi.fn(), logLevel: vi.fn(),
        getHeaders: vi.fn(() => ({ traceparent: 'x' })),
        addContext: vi.fn(), setContext: vi.fn(), clearContext: vi.fn(),
        child: vi.fn(() => ({}) as IFroggerLogger),
        reactiveChild: vi.fn(() => ({}) as IFroggerLogger),
        span: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
        startSpan: vi.fn(() => ({}) as IFroggerLogger),
        addReporter: vi.fn(), removeReporter: vi.fn(),
        getReporters: vi.fn(() => []), clearReporters: vi.fn(),
        reset: vi.fn(),
        identify: vi.fn(), setSession: vi.fn(), setRoute: vi.fn(),
        setAttribute: vi.fn(), event: vi.fn(),
        getSpanContext: vi.fn(() => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })),
    } as unknown as IFroggerLogger
}

/**
 * Every non-log method the facade is supposed to hand through to the resolved
 * logger. A name that reaches the FroggerAmbient interface but never gets a
 * `facade.x = ...` line compiles fine and fails only at runtime, as `undefined`
 * - which is exactly how setSession/setRoute went missing.
 */
const PASS_THROUGH_METHODS = [
    'getHeaders', 'identify', 'setSession', 'setRoute', 'event',
    'addContext', 'setContext', 'clearContext',
    'child', 'reactiveChild', 'span', 'startSpan',
    'addReporter', 'removeReporter', 'getReporters', 'clearReporters', 'reset',
] as const

describe('createAmbientFrogger', () => {
    let logger: ReturnType<typeof createMockLogger>
    let resolve: ReturnType<typeof vi.fn>
    let frogger: ReturnType<typeof createAmbientFrogger>

    beforeEach(() => {
        logger = createMockLogger()
        resolve = vi.fn(() => logger)
        frogger = createAmbientFrogger(resolve)
    })

    it('forwards each log level to the underlying logger as (message, context)', () => {
        frogger.info('hello', { a: 1 })
        expect(logger.info).toHaveBeenCalledWith('hello', { a: 1 })

        frogger.error('oops')
        expect(logger.error).toHaveBeenCalledWith('oops', undefined)

        frogger.warn('count', 5)
        expect(logger.warn).toHaveBeenCalledWith('count 5', undefined)
    })

    it('exposes every console-shaped level method', () => {
        for (const level of ['error', 'fatal', 'warn', 'log', 'info', 'success', 'fail', 'ready', 'start', 'debug', 'trace', 'silent', 'verbose'] as const) {
            frogger[level]('m')
            expect((logger as any)[level]).toHaveBeenCalledWith('m', undefined)
        }
    })

    it('resolves the underlying logger lazily on EVERY call (per-scope resolution)', () => {
        frogger.info('a')
        frogger.info('b')
        expect(resolve).toHaveBeenCalledTimes(2)
    })

    it('forwards logLevel with the level plus normalized args', () => {
        frogger.logLevel('info', 'dynamic', { k: 'v' })
        expect(logger.logLevel).toHaveBeenCalledWith('info', 'dynamic', { k: 'v' })
    })

    it('passes tracing/context helpers straight through', () => {
        expect(frogger.getHeaders('vendor')).toEqual({ traceparent: 'x' })
        expect(logger.getHeaders).toHaveBeenCalledWith('vendor')

        const ctx = { scope: 'a' }
        frogger.addContext(ctx)
        expect(logger.addContext).toHaveBeenCalledWith(ctx, undefined)

        const ctxWithOpts = { user: 'u1' }
        frogger.addContext(ctxWithOpts, { overwrite: false })
        expect(logger.addContext).toHaveBeenCalledWith(ctxWithOpts, { overwrite: false })

        frogger.child({})
        expect(logger.child).toHaveBeenCalled()

        frogger.reset()
        expect(logger.reset).toHaveBeenCalled()
    })

    it('delegates span to the resolved logger and returns its result', async () => {
        const fn = vi.fn(async () => 'result')

        await expect(frogger.span('checkout', fn)).resolves.toBe('result')
        expect(logger.span).toHaveBeenCalledWith('checkout', fn, undefined)
        expect(resolve).toHaveBeenCalled()
    })

    it('forwards span options to the resolved logger', async () => {
        const fn = vi.fn(async () => 'result')
        const options = { metric: true, labels: { tier: 'paid' } }

        await frogger.span('checkout', fn, options)

        expect(logger.span).toHaveBeenCalledWith('checkout', fn, options)
    })

    it('delegates startSpan to the resolved logger', () => {
        const options = { level: 4 }
        frogger.startSpan('checkout', options)

        expect(logger.startSpan).toHaveBeenCalledWith('checkout', options)
    })

    describe('console parity', () => {
        it('assert logs an error only when the condition is falsy', () => {
            frogger.assert(true, 'should not log')
            expect(logger.error).not.toHaveBeenCalled()

            frogger.assert(false, 'bad state', { detail: 1 })
            expect(logger.error).toHaveBeenCalledWith('Assertion failed: bad state', { detail: 1 })
        })

        it('table and dir route to structured info records', () => {
            frogger.table([{ a: 1 }])
            expect(logger.info).toHaveBeenCalledWith('table', { table: [{ a: 1 }] })

            frogger.dir({ nested: true })
            expect(logger.info).toHaveBeenCalledWith('dir', { dir: { nested: true } })
        })

        it('group emits a debug record, groupEnd is a safe no-op', () => {
            frogger.group('section')
            expect(logger.debug).toHaveBeenCalledWith('section', undefined)
            expect(() => frogger.groupEnd()).not.toThrow()
        })

        it('count/time family are safe no-ops that never throw', () => {
            expect(() => {
                frogger.count('c')
                frogger.countReset('c')
                frogger.time('t')
                frogger.timeLog('t')
                frogger.timeEnd('t')
            }).not.toThrow()
        })
    })
})

describe('createAmbientFrogger correlation setters', () => {
    let logger: ReturnType<typeof createMockLogger>
    let frogger: ReturnType<typeof createAmbientFrogger>

    beforeEach(() => {
        logger = createMockLogger()
        frogger = createAmbientFrogger(() => logger)
    })

    it('wires every pass-through method onto the facade', () => {
        for (const name of PASS_THROUGH_METHODS) {
            expect(typeof (frogger as unknown as Record<string, unknown>)[name], `facade.${name} is not wired`).toBe('function')
        }
    })

    it('forwards setSession to the resolved logger', () => {
        frogger.setSession({ id: 'sess_9f2c', sampled: true })
        expect(logger.setSession).toHaveBeenCalledWith({ id: 'sess_9f2c', sampled: true })
    })

    it('forwards a cleared session', () => {
        frogger.setSession(undefined)
        expect(logger.setSession).toHaveBeenCalledWith(undefined)
    })

    it('forwards setRoute to the resolved logger', () => {
        frogger.setRoute('/orders/[id]')
        expect(logger.setRoute).toHaveBeenCalledWith('/orders/[id]')
    })

    it('forwards identify alongside them', () => {
        frogger.identify('user_4471')
        expect(logger.identify).toHaveBeenCalledWith('user_4471')
    })

    it('resolves the logger per call, so a later scope sees its own', () => {
        const first = createMockLogger()
        const second = createMockLogger()
        let current = first
        const scoped = createAmbientFrogger(() => current)

        scoped.setSession({ id: 's1', sampled: true })
        current = second
        scoped.setSession({ id: 's2', sampled: true })

        expect(first.setSession).toHaveBeenCalledWith({ id: 's1', sampled: true })
        expect(second.setSession).toHaveBeenCalledWith({ id: 's2', sampled: true })
        expect(first.setSession).toHaveBeenCalledTimes(1)
    })
})
