/**
 * `nuxt-frogger/testing` — Vitest helpers for asserting what your app logged.
 *
 * Pure module: it never imports Nuxt's `#imports` at the top level, so it loads
 * fine from a plain Vitest context. The one place that needs the Nitro runtime
 * ({@link flushFrogger}) reaches for it via a dynamic import, and only when
 * called from inside a Nuxt test environment.
 *
 * The capture story is the memory transport: add `memoryTransport({ name })` to
 * your `transports`, drive the code under test, then read the captures back with
 * {@link getCapturedLogs}. The `name` is the shared key between the two.
 */

// Explicit `.js` extensions: these specifiers cross out of this build entry's
// input dir, so mkdist leaves them verbatim — they must already resolve under
// plain Node ESM (Playwright loads the built output that way).
import { LEVEL_TO_NUMBER } from '../runtime/shared/types/log.js'
import {
    MemoryTransport,
    getMemoryStore,
    clearMemoryStore,
} from '../runtime/logger/_transports/memory-transport.js'
import { memoryTransport } from '../runtime/shared/transports/factories.js'

import type { LoggerObject } from '../runtime/shared/types/log.js'

export { MemoryTransport, memoryTransport }
export type { LoggerObject }

/** The default registry key used when a memory transport is added without a `name`. */
export const DEFAULT_CAPTURE_NAME = 'memory'

/**
 * Predicate for narrowing a captured-log list. Every field is optional and all
 * present fields must match (logical AND).
 */
export interface LogMatcher {
    /**
     * Level to match, as a name (`'warn'`, `'error'`, …) or the numeric `lvl`.
     * Names are mapped through Frogger's level table before comparing.
     */
    level?: string | number
    /** Exact `type` match (consola log type, e.g. `'info'`, `'success'`). */
    type?: string
    /** Substring (string) or pattern (RegExp) match against `msg`. */
    msg?: string | RegExp
    /** Subset match against `ctx` — every listed key must deep-equal the log's. */
    ctx?: Record<string, unknown>
    /** Exact match against `trace.traceId`. */
    traceId?: string
}

/** Options for {@link getCapturedLogs}: which store to read, plus inline filters. */
export interface GetCapturedLogsOptions extends LogMatcher {
    /** Registry key of the memory transport. @default {@link DEFAULT_CAPTURE_NAME} */
    name?: string
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false
    }
    return JSON.stringify(a) === JSON.stringify(b)
}

function matchesOne(log: LoggerObject, matcher: LogMatcher): boolean {
    if (matcher.level !== undefined) {
        const wanted = typeof matcher.level === 'number'
            ? matcher.level
            : LEVEL_TO_NUMBER[matcher.level]
        if (log.lvl !== wanted) return false
    }

    if (matcher.type !== undefined && log.type !== matcher.type) {
        return false
    }

    if (matcher.msg !== undefined) {
        if (matcher.msg instanceof RegExp) {
            if (!matcher.msg.test(log.msg)) return false
        }
        else if (!log.msg.includes(matcher.msg)) {
            return false
        }
    }

    if (matcher.ctx !== undefined) {
        const ctx = log.ctx ?? {}
        for (const key of Object.keys(matcher.ctx)) {
            if (!deepEqual(ctx[key], matcher.ctx[key])) return false
        }
    }

    if (matcher.traceId !== undefined && log.trace?.traceId !== matcher.traceId) {
        return false
    }

    return true
}

/**
 * Filter a list of captured logs by a {@link LogMatcher}. The shared predicate
 * behind {@link getCapturedLogs} and the `toHaveLogged` matcher.
 */
export function filterLogs(logs: LoggerObject[], matcher: LogMatcher = {}): LoggerObject[] {
    return logs.filter(log => matchesOne(log, matcher))
}

/**
 * Read the logs captured by a named memory transport, optionally filtered.
 *
 * ```ts
 * const warnings = getCapturedLogs({ name: 'test', level: 'warn' })
 * ```
 */
export function getCapturedLogs(options: GetCapturedLogsOptions = {}): LoggerObject[] {
    const { name = DEFAULT_CAPTURE_NAME, ...matcher } = options
    const logs = getMemoryStore(name)
    return filterLogs(logs, matcher)
}

/**
 * Clear the captures for a named memory transport (default: {@link DEFAULT_CAPTURE_NAME}),
 * or every store when called with no argument. Call between tests.
 */
export function clearCapturedLogs(name: string | undefined = DEFAULT_CAPTURE_NAME): void {
    clearMemoryStore(name)
}

/**
 * Force the server log queue to drain synchronously.
 *
 * Frogger batches server-side, so a log written mid-test may still be sitting in
 * the `BatchTransport` window when you assert. Await this first. Pairs with the
 * `batch: false` recommendation in the docs: with batching off there is nothing
 * to drain, and fake timers never fight the `maxAge` window.
 *
 * Uses a dynamic import so this module stays importable outside a Nitro runtime.
 */
export async function flushFrogger(): Promise<void> {
    const { ServerLogQueueService } = await import(
        '../runtime/server/services/server-log-queue.js'
    )
    await ServerLogQueueService.getInstance().flush()
}

/**
 * Build the `useRuntimeConfig()` object the in-repo `*.nuxt.test.ts` files
 * assemble by hand, with sensible test defaults (batching off, scrub/websocket
 * disabled). Pass `overrides` to layer onto `frogger` / `public.frogger`.
 *
 * Note: `mockNuxtImport('useRuntimeConfig', …)` is a compile-time macro that
 * must stay at the top level of your test file — this helper only supplies the
 * value the mock should return, not the mock call itself:
 *
 * ```ts
 * const { rc } = vi.hoisted(() => ({ rc: vi.fn() }))
 * mockNuxtImport('useRuntimeConfig', () => rc)
 * beforeEach(() => rc.mockReturnValue(froggerTestRuntimeConfig({
 *   frogger: { transports: [memoryTransport({ name: 'test' })] },
 * })))
 * ```
 */
export function froggerTestRuntimeConfig(
    overrides: {
        frogger?: Record<string, unknown>
        public?: { frogger?: Record<string, unknown> }
    } = {},
): Record<string, unknown> {
    const { frogger: froggerOverrides, public: publicOverrides } = overrides
    return {
        public: {
            frogger: {
                app: 'test-app',
                baseUrl: '',
                ...(publicOverrides?.frogger ?? {}),
            },
        },
        frogger: {
            scrub: false,
            batch: false,
            websocket: false,
            transports: [],
            ...(froggerOverrides ?? {}),
        },
    }
}

/**
 * Produce the `$fetch` stub the in-repo nuxt tests install via
 * `vi.stubGlobal('$fetch', …)` — a no-op that resolves `{}`. Call it inside a
 * `beforeEach` (or wherever you set up globals).
 *
 * ```ts
 * import { vi } from 'vitest'
 * beforeEach(() => vi.stubGlobal('$fetch', stubFroggerFetch()))
 * ```
 */
export function stubFroggerFetch(): (...args: unknown[]) => Promise<unknown> {
    return () => Promise.resolve({})
}

/**
 * Opt-in registration of the `toHaveLogged` Vitest matcher:
 *
 * ```ts
 * import { registerFroggerMatchers } from 'nuxt-frogger/testing'
 * registerFroggerMatchers()
 * expect(getCapturedLogs({ name: 'test' })).toHaveLogged({ level: 'warn', msg: /redeploy/ })
 * ```
 *
 * Opt-in (rather than a side-effecting import) so importing the testing helpers
 * never silently mutates global `expect`.
 */
export async function registerFroggerMatchers(): Promise<void> {
    const { expect } = await import('vitest')
    expect.extend({
        toHaveLogged(received: LoggerObject[], matcher: LogMatcher) {
            if (!Array.isArray(received)) {
                return {
                    pass: false,
                    message: () =>
                        `expected an array of captured logs but received ${typeof received}`,
                }
            }

            const matches = filterLogs(received, matcher)
            const pass = matches.length > 0
            const describe = JSON.stringify(matcher)

            return {
                pass,
                message: () =>
                    pass
                        ? `expected no log matching ${describe}, but ${matches.length} did`
                        : `expected a log matching ${describe}, but none of ${received.length} captured logs did`,
                actual: received,
                expected: matcher,
            }
        },
    })
}

declare module 'vitest' {
    interface Assertion<T = any> {
        toHaveLogged(matcher: LogMatcher): T
    }
    interface AsymmetricMatchersContaining {
        toHaveLogged(matcher: LogMatcher): void
    }
}
