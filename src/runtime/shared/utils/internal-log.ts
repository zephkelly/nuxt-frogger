/**
 * Frogger's own internal diagnostics channel.
 *
 * This is NOT for the user's application logs — it is for Frogger's own chatter
 * (transport state changes, websocket bookkeeping, caught errors in its
 * machinery, etc). Every internal `console.*` call in the runtime should route
 * through here so it can be silenced.
 *
 * Levels, from least to most noisy: `silent` < `error` < `warn` < `info` < `debug`.
 *
 * Default behaviour:
 *  - production: `silent` (Frogger says nothing about itself)
 *  - development: `warn` (warnings and genuine errors, but no routine chatter)
 *
 * Users override via the `verbose` / `logLevel` module options, which are
 * resolved with {@link resolveInternalLogLevel} and pushed to runtime config so
 * the client and server plugins can call {@link configureInternalLog} at startup.
 */

export type InternalLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

const LEVEL_WEIGHT: Record<InternalLogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
}

const PREFIX = '🐸 Frogger'

/**
 * Resolve the effective internal log level from the `verbose` / `logLevel`
 * module options. `logLevel` wins when set; otherwise `verbose: true` maps to
 * `debug` and `verbose: false` to `silent`. When neither is given, the level
 * falls back to environment defaults (`warn` in dev, `silent` in production).
 *
 * Shared by the build-time module setup and the runtime plugins so both agree
 * on what "quiet" means.
 */
export function resolveInternalLogLevel(
    verbose: boolean | undefined,
    logLevel: InternalLogLevel | undefined,
    isDev: boolean,
): InternalLogLevel {
    if (logLevel !== undefined) {
        return logLevel
    }
    if (verbose === true) {
        return 'debug'
    }
    if (verbose === false) {
        return 'silent'
    }
    return isDev ? 'warn' : 'silent'
}

function environmentDefaultLevel(): InternalLogLevel {
    // `import.meta.dev` is replaced at build time by Nuxt/Vite in runtime bundles.
    // It is undefined in raw Node contexts (e.g. the build-time module), so guard it.
    // Cast keeps this resilient whether or not Nuxt's ambient types are present.
    try {
        const meta = import.meta as unknown as { dev?: boolean }
        if (meta.dev) {
            return 'warn'
        }
        if (typeof meta.dev !== 'undefined') {
            return 'silent'
        }
    }
    catch {
        // import.meta not available — fall through to NODE_ENV
    }

    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
        return 'warn'
    }
    return 'silent'
}

let currentLevel: InternalLogLevel = environmentDefaultLevel()

/**
 * Set the active internal log level. Called by the runtime plugins from the
 * resolved module option. Accepts the boolean `verbose` shorthand too.
 */
export function configureInternalLog(level: InternalLogLevel | boolean | undefined): void {
    if (level === undefined) {
        return
    }
    if (typeof level === 'boolean') {
        currentLevel = level ? 'debug' : 'silent'
        return
    }
    currentLevel = level
}

/** Current effective internal log level. */
export function getInternalLogLevel(): InternalLogLevel {
    return currentLevel
}

function enabled(level: Exclude<InternalLogLevel, 'silent'>): boolean {
    return LEVEL_WEIGHT[currentLevel] >= LEVEL_WEIGHT[level]
}

/**
 * Leveled internal logger. Use `error` for caught failures in Frogger's own
 * machinery, `warn` for recoverable misconfiguration, `info` for noteworthy
 * lifecycle events, and `debug` for routine per-operation chatter.
 */
export const froggerInternal = {
    error(...args: unknown[]): void {
        if (enabled('error')) {
            console.error(PREFIX, ...args)
        }
    },
    warn(...args: unknown[]): void {
        if (enabled('warn')) {
            console.warn(PREFIX, ...args)
        }
    },
    info(...args: unknown[]): void {
        if (enabled('info')) {
            console.log(PREFIX, ...args)
        }
    },
    debug(...args: unknown[]): void {
        if (enabled('debug')) {
            console.log(PREFIX, ...args)
        }
    },
}
