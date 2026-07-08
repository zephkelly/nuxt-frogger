import type { IFroggerLogger } from './types'

// Browser counterpart of active-context.server.ts (same export shape).
// No AsyncLocalStorage exists in browsers, so this is a plain module variable:
// correct for sequential await chains, best-effort under interleaved async
// (two concurrently-awaiting spans can observe each other's active logger).
let active: IFroggerLogger | undefined

/**
 * The logger installed by the innermost enclosing `span()`, or undefined when
 * no span is open. Ambient resolvers check this first so logs emitted anywhere
 * inside a span nest under it.
 */
export function getActiveLogger(): IFroggerLogger | undefined {
    return active
}

/**
 * Run `fn` with `logger` as the active logger, restoring the previous active
 * logger when `fn` settles.
 */
export async function runWithLogger<T>(logger: IFroggerLogger, fn: () => T | Promise<T>): Promise<T> {
    const prev = active
    active = logger
    try {
        return await fn()
    }
    finally {
        active = prev
    }
}
