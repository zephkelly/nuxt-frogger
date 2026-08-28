/**
 * Exponential backoff with full jitter.
 *
 * Backoff was implemented three separate times - the client queue, the HTTP
 * transport and the batch transport - none of them with jitter. Without jitter
 * every instance behind a load balancer retries a recovering sink at the SAME
 * instant, so the sink's first moment of recovery is also its next thundering
 * herd, and it goes down again.
 *
 * Full jitter (a uniform draw over the whole window, not a small wobble around
 * it) is AWS's recommendation and measurably beats the alternatives at spreading
 * a retry storm.
 */
export interface BackoffOptions {
    /** Delay for the first retry, in ms. */
    baseMs: number
    /** Ceiling for the computed window, in ms. */
    maxMs?: number
    /** Set false in tests that assert on an exact delay. @default true */
    jitter?: boolean
}

export function backoffDelay(attempt: number, options: BackoffOptions): number {
    const { baseMs, maxMs = 300_000, jitter = true } = options

    const window = Math.min(baseMs * Math.pow(2, Math.max(0, attempt)), maxMs)

    return jitter ? Math.floor(Math.random() * window) : window
}

/**
 * A server-supplied `Retry-After` in ms, when the response gave one.
 *
 * Honoured over the computed backoff: the destination knows when it will be
 * ready and we do not.
 */
export function retryAfterMs(error: unknown): number | undefined {
    const header = (error as { response?: { headers?: { get?: (name: string) => string | null } } })
        ?.response?.headers?.get?.('retry-after')

    if (!header) return undefined

    const seconds = Number(header)
    if (Number.isFinite(seconds)) return seconds * 1000

    // The header also permits an HTTP-date.
    const date = Date.parse(header)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())

    return undefined
}
