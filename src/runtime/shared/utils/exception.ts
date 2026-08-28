import { serializeError } from './normalize-errors'

/**
 * How an error reached Frogger. The distinction that matters for triage: an
 * error the app deliberately logged is a different thing from one that crashed
 * uncaught, and a reader cannot tell them apart from the message.
 */
export type ExceptionMechanism =
    | 'manual'
    | 'onerror'
    | 'unhandledrejection'
    | 'vue-errorHandler'
    | 'nitro-error-hook'
    | 'uncaught-exception'

/**
 * One normalised exception shape, following OTel's semantic conventions.
 *
 * Error shape used to be invented per capture site - four different layouts
 * across the server plugin alone, plus a fifth from `serializeError` - so a
 * reader had to special-case all of them.
 */
export interface NormalisedException {
    'exception.type': string
    'exception.message': string
    'exception.stacktrace'?: string
    /**
     * Whether the error propagated OUT of the scope that saw it, rather than
     * being handled there. This is the distinction that decides whether
     * something is a bug or a handled condition.
     */
    'exception.escaped': boolean
    /**
     * Advisory grouping key: `name` plus a templated message plus, for
     * server-origin errors, the first app stack frame. A HINT a reader may
     * regroup on, never an identity - `ctx.fingerprint` overrides it.
     */
    'exception.fingerprint'?: string
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi
const DIGITS_RE = /\b\d+\b/g
const QUOTED_RE = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g

/**
 * Collapse the variable parts of a message into placeholders, so 4,000
 * occurrences of one bug group as one thing rather than 4,000 things.
 */
export function templateMessage(message: string): string {
    return message
        .replace(UUID_RE, '<uuid>')
        .replace(QUOTED_RE, '<str>')
        .replace(LONG_HEX_RE, '<hex>')
        .replace(DIGITS_RE, '<n>')
        .trim()
        .slice(0, 200)
}

/**
 * The first stack frame that looks like application code.
 *
 * Server-origin only by design: browser stacks are minified at capture time,
 * so keying on a chunk hash would split one error into a fresh group on every
 * deploy - which is worse than not grouping at all.
 */
function firstAppFrame(stack: string | undefined): string | undefined {
    if (!stack) return undefined

    for (const line of stack.split('\n').slice(1)) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('at ')) continue
        if (trimmed.includes('node_modules') || trimmed.includes('node:internal')) continue

        // Strip the absolute path and the line/column, which vary per machine
        // and per edit and would otherwise defeat the grouping entirely.
        const match = trimmed.match(/at\s+([^\s(]+)/)
        return match?.[1]?.slice(0, 120)
    }

    return undefined
}

/**
 * A stable, advisory grouping key. `null` when there is not enough to key on.
 */
export function fingerprintOf(
    name: string,
    message: string,
    stack: string | undefined,
    includeFrame: boolean,
): string | undefined {
    const parts = [name, templateMessage(message)]

    if (includeFrame) {
        const frame = firstAppFrame(stack)
        if (frame) parts.push(frame)
    }

    const key = parts.filter(Boolean).join('|')
    return key.length > 0 ? key : undefined
}

export interface NormaliseExceptionOptions {
    mechanism: ExceptionMechanism
    /** Did the error propagate out of the scope that observed it? */
    escaped?: boolean
    includeStack?: boolean
    /** Server stacks are stable enough to key on; minified browser ones are not. */
    serverOrigin?: boolean
    /** A caller-supplied grouping key, which always wins. */
    fingerprint?: string
}

/**
 * Funnel every capture path through one shape.
 *
 * Emitted ADDITIVELY alongside whatever flat keys a capture site already
 * writes: keeping those costs nothing, and removing them would break every
 * reader that learned the old layout before there was a spec to read.
 */
export function normaliseException(
    error: unknown,
    options: NormaliseExceptionOptions,
): { exception: NormalisedException, mechanism: ExceptionMechanism } {
    const isError = error instanceof Error
    const name = isError ? error.name : 'Error'
    const message = isError ? error.message : String(error)
    const stack = isError && options.includeStack !== false ? error.stack : undefined

    if (isError) {
        // Keeps the dedupe stamp behaviour consistent with the flat path.
        serializeError(error)
    }

    const exception: NormalisedException = {
        'exception.type': name,
        'exception.message': message,
        'exception.escaped': options.escaped ?? false,
    }

    if (stack) exception['exception.stacktrace'] = stack

    const fingerprint = options.fingerprint
        ?? fingerprintOf(name, message, isError ? error.stack : undefined, options.serverOrigin === true)

    if (fingerprint) exception['exception.fingerprint'] = fingerprint

    return { exception, mechanism: options.mechanism }
}
