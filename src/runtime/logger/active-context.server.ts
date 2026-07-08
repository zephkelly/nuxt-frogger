import { AsyncLocalStorage } from 'node:async_hooks'

import type { IFroggerLogger } from './types'

// Server-only: node:async_hooks must never reach the client bundle, so this
// file is imported exclusively from server-runtime modules (import-site
// selection, no runtime guards). The client counterpart lives in
// active-context.client.ts with the identical export shape.
const als = new AsyncLocalStorage<IFroggerLogger>()

/**
 * The logger installed by the innermost enclosing `span()`, or undefined when
 * no span is open. Ambient resolvers check this first so logs emitted anywhere
 * inside a span nest under it.
 */
export function getActiveLogger(): IFroggerLogger | undefined {
    return als.getStore()
}

/**
 * Run `fn` with `logger` as the active logger. ALS propagates the value across
 * every await in `fn`'s async chain and isolates concurrent chains, so two
 * overlapping requests each see only their own span tree.
 */
export async function runWithLogger<T>(logger: IFroggerLogger, fn: () => T | Promise<T>): Promise<T> {
    // async so a synchronous throw from fn surfaces as a rejection, matching
    // the client implementation.
    return als.run(logger, fn)
}
