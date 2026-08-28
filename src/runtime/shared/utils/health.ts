import { froggerInternal } from './internal-log'

/**
 * Why a record was dropped. Every loss path in the pipeline increments exactly
 * one of these.
 */
export interface FroggerDropCounts {
    /** A bounded queue or buffer was full. */
    overflow: number
    /** The destination rate-limited us, or blocked this client. */
    rateLimited: number
    /** The destination returned a non-429 4xx: bad key, bad schema. */
    rejected4xx: number
    /** Retries were exhausted against a destination that never recovered. */
    retriesExhausted: number
    /** An exception inside Frogger's own machinery lost the record. */
    pipelineError: number
}

export interface FroggerHealth {
    enqueued: number
    delivered: number
    dropped: FroggerDropCounts
    lastError?: string
    lastErrorAt?: number
}

/**
 * Process-global so a single reading covers every queue and transport in the
 * process, and so `getFroggerHealth()` returns the same numbers whichever
 * module graph asks. Hung off `globalThis` for the same reason the memory
 * store is: a runtime can be bundled more than once.
 */
const HEALTH: FroggerHealth = (
    (globalThis as unknown as { __FROGGER_HEALTH__?: FroggerHealth }).__FROGGER_HEALTH__ ??= {
        enqueued: 0,
        delivered: 0,
        dropped: {
            overflow: 0,
            rateLimited: 0,
            rejected4xx: 0,
            retriesExhausted: 0,
            pipelineError: 0,
        },
    }
)

let warnedOnFirstDrop = false

export function recordEnqueued(count = 1): void {
    HEALTH.enqueued += count
}

export function recordDelivered(count = 1): void {
    HEALTH.delivered += count
}

/**
 * Count a loss, and say so out loud the first time.
 *
 * Frogger's stated invariant is that a customer log is never silently dropped,
 * but every loss path reported through the level-gated internal channel, whose
 * production default is silent. A misconfigured API key discarded 100% of
 * production logs with literally no output anywhere. The first drop now always
 * prints; the counters carry the rest.
 */
export function recordDropped(
    reason: keyof FroggerDropCounts,
    count: number,
    detail?: string,
): void {
    if (count <= 0) return

    HEALTH.dropped[reason] += count

    if (detail) {
        HEALTH.lastError = detail
        HEALTH.lastErrorAt = Date.now()
    }

    if (!warnedOnFirstDrop) {
        warnedOnFirstDrop = true
        froggerInternal.always.warn(
            `Dropping logs (${reason}${detail ? `: ${detail}` : ''}). `
            + `This is the first drop in this process; further drops are counted silently. `
            + `Call getFroggerHealth() for the running totals.`,
        )
    }
}

export function recordPipelineError(error: unknown): void {
    HEALTH.dropped.pipelineError += 1
    HEALTH.lastError = error instanceof Error ? error.message : String(error)
    HEALTH.lastErrorAt = Date.now()
}

/**
 * A snapshot of what this process has enqueued, delivered and dropped.
 *
 * This is what makes "a log is never silently dropped" testable rather than
 * aspirational. Deliberately a plain accessor and not a metric: emitting
 * metrics about a failing pipeline through that same pipeline is a feedback
 * loop, and the counters already carry the information.
 */
export function getFroggerHealth(): FroggerHealth {
    return {
        enqueued: HEALTH.enqueued,
        delivered: HEALTH.delivered,
        dropped: { ...HEALTH.dropped },
        lastError: HEALTH.lastError,
        lastErrorAt: HEALTH.lastErrorAt,
    }
}

/** Test seam: zero every counter and re-arm the first-drop warning. */
export function resetFroggerHealth(): void {
    HEALTH.enqueued = 0
    HEALTH.delivered = 0
    HEALTH.dropped.overflow = 0
    HEALTH.dropped.rateLimited = 0
    HEALTH.dropped.rejected4xx = 0
    HEALTH.dropped.retriesExhausted = 0
    HEALTH.dropped.pipelineError = 0
    HEALTH.lastError = undefined
    HEALTH.lastErrorAt = undefined
    warnedOnFirstDrop = false
}
