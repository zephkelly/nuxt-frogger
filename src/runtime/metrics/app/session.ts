/**
 * Per-session sampling decision, decided ONCE per session and persisted in
 * `sessionStorage` so it (and the session id) survive hard reloads within a tab
 * (Faro's decide-once model). Kept as a pure module — no browser globals at the
 * top level — so the sampling logic is unit-testable in a plain Node context.
 */

export const METRICS_SESSION_STORAGE_KEY = 'frogger:metrics:session'

export interface MetricsSession {
    id: string
    sampled: boolean
}

/**
 * Deterministic sampling decision from a rate in `[0, 1]` and a `[0, 1)` random
 * draw. `rate >= 1` always samples, `rate <= 0` never does — so the boundaries
 * never depend on the RNG.
 */
export function decideSampled(sampleRate: number, random: number): boolean {
    if (sampleRate >= 1) return true
    if (sampleRate <= 0) return false
    return random < sampleRate
}

/** Parse a persisted session record, or `null` when absent/corrupt. */
export function parseSession(raw: string | null): MetricsSession | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as unknown
        if (
            parsed && typeof parsed === 'object'
            && typeof (parsed as MetricsSession).id === 'string'
            && typeof (parsed as MetricsSession).sampled === 'boolean'
        ) {
            return parsed as MetricsSession
        }
    }
    catch {
        // corrupt record — treat as absent
    }
    return null
}
