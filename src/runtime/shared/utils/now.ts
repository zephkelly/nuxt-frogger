/**
 * Monotonic clock, for DURATIONS only.
 *
 * `Date.now()` is wall-clock: 1ms granularity, and it steps under NTP
 * correction, so a sub-millisecond span reads as `0` and a backwards clock step
 * can produce a negative duration. Timestamps (`LoggerObject.time`,
 * `MetricObject.time`) must keep `Date.now()` because they are compared across
 * machines; only elapsed time inside one process belongs here.
 */
export function monotonicNow(): number {
    // Feature-detected rather than called directly: Node has had a global
    // `performance` since 16, but a test double or an exotic runtime may not.
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now()
    }
    return Date.now()
}

/**
 * Elapsed milliseconds since a {@link monotonicNow} reading, rounded to
 * microseconds. The rounding exists so a duration never serialises as
 * `12.339999999999999`; the precision below 1ms is the point of the change.
 */
export function elapsedMs(start: number): number {
    return Math.round((monotonicNow() - start) * 1000) / 1000
}

/** Elapsed seconds since a {@link monotonicNow} reading (the metric base unit). */
export function elapsedSeconds(start: number): number {
    return elapsedMs(start) / 1000
}
