import type { LogType } from 'consola'

import type { IFroggerLogger } from './types'
import type { IFroggerReporter } from './_reporters/types'
import type { FroggerOptions } from '../shared/types/options'
import { normalizeLogArgs } from '../shared/utils/normalize-log-args'

/**
 * The ambient `frogger` surface: a console-shaped facade over a real
 * {@link IFroggerLogger}. Log methods are variadic (like `console.*`) and are
 * normalized into Frogger's `(message, context)` shape; the tracing/context
 * helpers pass straight through to the underlying logger.
 *
 * The underlying logger is resolved lazily, per call, via the `resolve` function
 * passed to {@link createAmbientFrogger} — app-scoped on the client, per-request
 * on the server — so every `frogger.*` call in a given scope shares ONE span
 * chain rather than fragmenting the trace.
 */
export interface FroggerAmbient {
    // Log levels (variadic, console-style) -------------------------------
    error(...args: unknown[]): void
    fatal(...args: unknown[]): void
    warn(...args: unknown[]): void
    log(...args: unknown[]): void
    info(...args: unknown[]): void
    success(...args: unknown[]): void
    fail(...args: unknown[]): void
    ready(...args: unknown[]): void
    start(...args: unknown[]): void
    debug(...args: unknown[]): void
    trace(...args: unknown[]): void
    silent(...args: unknown[]): void
    verbose(...args: unknown[]): void
    logLevel(level: LogType, ...args: unknown[]): void

    // Pass-throughs to the underlying logger -----------------------------
    getHeaders(customVendor?: string): Record<string, string>
    addContext(context: object): void
    setContext(context: object): void
    clearContext(): void
    child(options: FroggerOptions): IFroggerLogger
    reactiveChild(options: FroggerOptions): IFroggerLogger
    span<T>(name: string, fn: () => T | Promise<T>): Promise<T>
    startSpan(name: string, options?: FroggerOptions): IFroggerLogger
    addReporter(reporter: IFroggerReporter): void
    removeReporter(reporter: IFroggerReporter): void
    getReporters(): readonly IFroggerReporter[]
    clearReporters(): void
    reset(): void

    // console parity (so `console` → `frogger` never throws) -------------
    assert(condition: unknown, ...args: unknown[]): void
    table(data: unknown, ...args: unknown[]): void
    dir(item: unknown, ...args: unknown[]): void
    group(...args: unknown[]): void
    groupCollapsed(...args: unknown[]): void
    groupEnd(): void
    count(label?: string): void
    countReset(label?: string): void
    time(label?: string): void
    timeEnd(label?: string): void
    timeLog(label?: string, ...args: unknown[]): void
}

const LOG_LEVELS = [
    'error', 'fatal', 'warn', 'log', 'info', 'success',
    'fail', 'ready', 'start', 'debug', 'trace', 'silent', 'verbose',
] as const

/**
 * Build the ambient `frogger` facade around a lazy logger resolver. `resolve`
 * is invoked on every call (not at construction) so it runs inside a valid
 * Nuxt/Nitro context and so the correct scope-cached logger is used.
 */
export function createAmbientFrogger(resolve: () => IFroggerLogger): FroggerAmbient {
    const facade = {} as Record<string, any>

    for (const level of LOG_LEVELS) {
        facade[level] = (...args: unknown[]) => {
            const { message, context } = normalizeLogArgs(args)
            resolve()[level](message, context)
        }
    }

    facade.logLevel = (level: LogType, ...args: unknown[]) => {
        const { message, context } = normalizeLogArgs(args)
        resolve().logLevel(level, message, context)
    }

    facade.getHeaders = (customVendor?: string) => resolve().getHeaders(customVendor)
    facade.addContext = (context: object) => resolve().addContext(context)
    facade.setContext = (context: object) => resolve().setContext(context)
    facade.clearContext = () => resolve().clearContext()
    facade.child = (options: FroggerOptions) => resolve().child(options)
    facade.reactiveChild = (options: FroggerOptions) => resolve().reactiveChild(options)
    facade.span = <T>(name: string, fn: () => T | Promise<T>) => resolve().span(name, fn)
    facade.startSpan = (name: string, options?: FroggerOptions) => resolve().startSpan(name, options)
    facade.addReporter = (reporter: IFroggerReporter) => resolve().addReporter(reporter)
    facade.removeReporter = (reporter: IFroggerReporter) => resolve().removeReporter(reporter)
    facade.getReporters = () => resolve().getReporters()
    facade.clearReporters = () => resolve().clearReporters()
    facade.reset = () => resolve().reset()

    // console parity — aliased to structured records where it adds value,
    // safe no-ops for the rest, so a literal `console` → `frogger` swap is safe.
    facade.assert = (condition: unknown, ...args: unknown[]) => {
        if (condition) {
            return
        }
        const { message, context } = normalizeLogArgs(args)
        resolve().error(message ? `Assertion failed: ${message}` : 'Assertion failed', context)
    }
    facade.table = (data: unknown, ...rest: unknown[]) => {
        const { context } = normalizeLogArgs(rest)
        resolve().info('table', { ...(context || {}), table: data })
    }
    facade.dir = (item: unknown, ...rest: unknown[]) => {
        const { context } = normalizeLogArgs(rest)
        resolve().info('dir', { ...(context || {}), dir: item })
    }
    facade.group = (...args: unknown[]) => {
        const { message, context } = normalizeLogArgs(args)
        resolve().debug(message || 'group', context)
    }
    facade.groupCollapsed = facade.group
    facade.groupEnd = () => { /* no terminal grouping in transports */ }
    facade.count = () => { /* no-op */ }
    facade.countReset = () => { /* no-op */ }
    facade.time = () => { /* no-op */ }
    facade.timeEnd = () => { /* no-op */ }
    facade.timeLog = () => { /* no-op */ }

    return facade as FroggerAmbient
}
