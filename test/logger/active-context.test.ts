import { describe, it, expect } from 'vitest'

import * as serverContext from '../../src/runtime/logger/active-context.server'
import * as clientContext from '../../src/runtime/logger/active-context.client'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

const loggerA = { name: 'logger-a' } as unknown as IFroggerLogger
const loggerB = { name: 'logger-b' } as unknown as IFroggerLogger

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Both implementations expose the identical { getActiveLogger, runWithLogger }
// shape and must satisfy the same sequential contract.
const implementations = [
    ['server (AsyncLocalStorage)', serverContext],
    ['client (module variable)', clientContext],
] as const

describe.each(implementations)('active-context: %s', (_name, ctx) => {
    it('has no active logger outside runWithLogger', () => {
        expect(ctx.getActiveLogger()).toBeUndefined()
    })

    it('exposes the logger inside a sync fn and restores after', async () => {
        let inside: IFroggerLogger | undefined

        await ctx.runWithLogger(loggerA, () => {
            inside = ctx.getActiveLogger()
        })

        expect(inside).toBe(loggerA)
        expect(ctx.getActiveLogger()).toBeUndefined()
    })

    it('keeps the logger active across awaits in an async fn', async () => {
        let beforeAwait: IFroggerLogger | undefined
        let afterAwait: IFroggerLogger | undefined

        await ctx.runWithLogger(loggerA, async () => {
            beforeAwait = ctx.getActiveLogger()
            await sleep(1)
            afterAwait = ctx.getActiveLogger()
        })

        expect(beforeAwait).toBe(loggerA)
        expect(afterAwait).toBe(loggerA)
        expect(ctx.getActiveLogger()).toBeUndefined()
    })

    it('propagates the return value (sync and async fn)', async () => {
        await expect(ctx.runWithLogger(loggerA, () => 42)).resolves.toBe(42)
        await expect(ctx.runWithLogger(loggerA, async () => 'done')).resolves.toBe('done')
    })

    it('restores the previous logger when nested', async () => {
        let inner: IFroggerLogger | undefined
        let afterInner: IFroggerLogger | undefined

        await ctx.runWithLogger(loggerA, async () => {
            await ctx.runWithLogger(loggerB, async () => {
                inner = ctx.getActiveLogger()
            })
            afterInner = ctx.getActiveLogger()
        })

        expect(inner).toBe(loggerB)
        expect(afterInner).toBe(loggerA)
        expect(ctx.getActiveLogger()).toBeUndefined()
    })

    it('restores the previous logger when fn rejects', async () => {
        await expect(
            ctx.runWithLogger(loggerA, async () => {
                throw new Error('boom')
            }),
        ).rejects.toThrow('boom')

        expect(ctx.getActiveLogger()).toBeUndefined()
    })

    it('restores the previous logger when a sync fn throws', async () => {
        await expect(
            ctx.runWithLogger(loggerA, () => {
                throw new Error('sync boom')
            }),
        ).rejects.toThrow('sync boom')

        expect(ctx.getActiveLogger()).toBeUndefined()
    })
})

describe('active-context: server isolation (AsyncLocalStorage)', () => {
    it('keeps concurrent async chains fully isolated', async () => {
        const seen: Record<string, IFroggerLogger | undefined> = {}

        await Promise.all([
            serverContext.runWithLogger(loggerA, async () => {
                await sleep(15)
                seen.a = serverContext.getActiveLogger()
            }),
            serverContext.runWithLogger(loggerB, async () => {
                await sleep(5)
                seen.b = serverContext.getActiveLogger()
            }),
        ])

        expect(seen.a).toBe(loggerA)
        expect(seen.b).toBe(loggerB)
        expect(serverContext.getActiveLogger()).toBeUndefined()
    })
})

describe('active-context: client best-effort behavior', () => {
    // Browsers have no AsyncLocalStorage, so the client context is a shared
    // module variable: correct for sequential await chains, but interleaved
    // async chains can observe each other's active logger. This test
    // documents that known limitation rather than asserting isolation.
    it('interleaved async chains may observe the most recently opened span', async () => {
        let observedInA: IFroggerLogger | undefined

        const a = clientContext.runWithLogger(loggerA, async () => {
            await sleep(15)
            observedInA = clientContext.getActiveLogger()
        })
        const b = clientContext.runWithLogger(loggerB, async () => {
            await sleep(30)
        })

        await Promise.all([a, b])

        expect(observedInA).toBe(loggerB)
    })
})
