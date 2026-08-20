/**
 * Normalizes console-style variadic arguments into Frogger's structured
 * `(message, context)` shape, so the ambient `frogger` logger can be a literal
 * drop-in for `console.*` while still producing the `{ msg, ctx }` LoggerObject
 * that the scrubber, reporters, and file/JSON sinks depend on.
 *
 * Rules:
 *  - A TRAILING plain object (a `{}` literal, not an Array/Error/Date/class
 *    instance) is lifted out as `context`.
 *  - All remaining leading arguments are formatted and space-joined into the
 *    `message` string — strings verbatim, Errors as their message (with the full
 *    error also lifted into `context.error`), everything else safe-stringified.
 *  - `frogger.info('done', { userId })` is therefore identical to the existing
 *    `info('done', { userId })` call — zero behavioural change for Frogger-style
 *    usage — while `frogger.log('count', 5)` becomes `msg: 'count 5'`.
 */

import { serializeError } from './normalize-errors'

export interface NormalizedLogArgs {
    message: string
    context?: Record<string, any>
}

/**
 * True only for "plain" objects — object literals and `Object.create(null)`.
 * Arrays, Errors, Dates, Maps, class instances, etc. are NOT treated as context
 * so they don't silently swallow real data into the context slot.
 */
function isPlainObject(value: unknown): value is Record<string, any> {
    if (value === null || typeof value !== 'object') {
        return false
    }
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

function stringifyPart(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (value instanceof Error) {
        return value.message
    }
    if (value === null) {
        return 'null'
    }
    if (value === undefined) {
        return 'undefined'
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value)
        }
        catch {
            return String(value)
        }
    }
    return String(value)
}

export function normalizeLogArgs(args: unknown[]): NormalizedLogArgs {
    if (args.length === 0) {
        return { message: '' }
    }

    let parts = args
    let context: Record<string, any> | undefined

    // A trailing plain object becomes the structured context.
    const last = parts[parts.length - 1]
    if (isPlainObject(last)) {
        context = last
        parts = parts.slice(0, -1)
    }

    // Lift the first Error into context.error (cloning context first so we never
    // mutate the caller's object), and fold error messages into the text.
    let firstError: Error | undefined
    const messageParts: string[] = []
    for (const part of parts) {
        if (part instanceof Error && !firstError) {
            firstError = part
        }
        messageParts.push(stringifyPart(part))
    }

    if (firstError) {
        context = { ...(context || {}) }
        if (context.error === undefined) {
            context.error = serializeError(firstError)
        }
    }

    return {
        message: messageParts.join(' '),
        context,
    }
}
