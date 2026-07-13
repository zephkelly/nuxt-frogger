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
    } as unknown as IFroggerLogger
}

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
        expect(logger.span).toHaveBeenCalledWith('checkout', fn)
        expect(resolve).toHaveBeenCalled()
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
