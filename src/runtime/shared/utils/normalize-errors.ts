/**
 * Error normalisation for log context.
 *
 * `Error`'s `name`/`message`/`stack` are non-enumerable, so an Error placed
 * inside a log's context (`frogger.error('x', { error: err })`) survives the
 * in-process pipeline but serialises to `{}` the moment a transport
 * `JSON.stringify`s it. The ambient console-style path already normalises
 * positional Errors (see normalize-log-args); this module extends the same
 * guarantee to the structured `(message, context)` API by deep-walking ctx and
 * replacing every Error instance with a plain, JSON-safe object.
 *
 * Enumerable own props are kept (pg/ofetch errors carry `code`, `statusCode`,
 * `detail`, ... there) and the canonical fields are written last so a
 * subclass can never shadow them with garbage. `cause` chains are serialised
 * recursively, depth-bounded.
 *
 * Every Error that passes through here is also stamped (non-enumerably) as
 * "already logged", which the server global-error capture uses to dedupe: an
 * error a handler caught and logged is not reported a second time by the
 * Nitro `error` hook.
 */

const MAX_CAUSE_DEPTH = 5
const MAX_WALK_DEPTH = 32

export const LOGGED_ERROR_STAMP = Symbol.for('nuxt-frogger.logged')

export interface SerializedError {
    name: string
    message: string
    stack?: string
    cause?: unknown
    [key: string]: unknown
}

/** Mark an Error as having been serialised into at least one log row. */
export function markErrorLogged(error: unknown): void {
    if (!(error instanceof Error)) return
    try {
        Object.defineProperty(error, LOGGED_ERROR_STAMP, {
            value: true,
            enumerable: false,
            configurable: true,
        })
    }
    catch {
        // Frozen/sealed errors just miss out on dedupe.
    }
}

export function isErrorLogged(error: unknown): boolean {
    return error instanceof Error
        && Reflect.get(error, LOGGED_ERROR_STAMP) === true
}

/**
 * Convert an Error into a plain JSON-safe object: enumerable own props first,
 * canonical non-enumerable fields last so they always win.
 */
export function serializeError(error: Error, depth: number = 0): SerializedError {
    const serialized: SerializedError = {
        ...error,
        name: error.name,
        message: error.message,
        stack: error.stack,
    }

    if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
        serialized.cause = error.cause instanceof Error
            ? serializeError(error.cause, depth + 1)
            : error.cause
    }

    markErrorLogged(error)

    return serialized
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (!value || typeof value !== 'object' || depth > MAX_WALK_DEPTH) {
        return value
    }

    if (value instanceof Error) {
        return serializeError(value)
    }

    if (seen.has(value)) {
        return value
    }
    seen.add(value)

    try {
        if (Array.isArray(value)) {
            let result: unknown[] = value
            for (let i = 0; i < value.length; i++) {
                const normalized = walk(value[i], depth + 1, seen)
                if (normalized !== value[i]) {
                    if (result === value) result = value.slice()
                    result[i] = normalized
                }
            }
            return result
        }

        // Only plain-ish objects are walked; Dates, Maps, class instances etc.
        // pass through untouched, matching the scrubber's traversal contract.
        const proto = Object.getPrototypeOf(value)
        if (proto !== Object.prototype && proto !== null) {
            return value
        }

        const record = value as Record<string, unknown>
        let result: Record<string, unknown> = record
        for (const [key, entry] of Object.entries(record)) {
            const normalized = walk(entry, depth + 1, seen)
            if (normalized !== entry) {
                if (result === record) result = { ...record }
                result[key] = normalized
            }
        }
        return result
    }
    finally {
        seen.delete(value)
    }
}

/**
 * Return `ctx` with every nested Error instance replaced by its serialised
 * form. Copy-on-write: subtrees containing no Error are returned by reference,
 * and the caller's object graph is never mutated. Cycle-safe and depth-bounded.
 */
export function normalizeContextErrors<T extends Record<string, unknown>>(ctx: T): T {
    return walk(ctx, 0, new WeakSet()) as T
}
