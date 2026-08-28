import type { H3Event } from 'h3'

/**
 * OTel's standard HTTP server duration buckets, in seconds. Adopted verbatim so
 * nothing downstream needs a translation table.
 */
export const HTTP_DURATION_BUCKETS = [
    0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
] as const

/** Frogger's own routes. Instrumenting them is a feedback loop. */
const SELF_ROUTE_PREFIX = '/api/_frogger/'

export function isSelfRequest(path: string | undefined): boolean {
    return Boolean(path && path.startsWith(SELF_ROUTE_PREFIX))
}

/**
 * The MATCHED ROUTE PATTERN for a request (`/orders/[id]`), or `undefined`.
 *
 * Never the raw path. `/orders/1`, `/orders/2`, ... are one series with a
 * pattern and one series EACH without it, and a metrics backend does not
 * recover from that. When no pattern is available the caller drops the
 * measurement; a partial signal beats an unbounded one.
 */
export function routePatternOf(event: H3Event): string | undefined {
    const matched = (event.context as { matchedRoute?: { path?: string } } | undefined)?.matchedRoute?.path
    if (typeof matched === 'string' && matched.length > 0) return matched

    return undefined
}
