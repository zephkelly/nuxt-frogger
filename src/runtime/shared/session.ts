import { uuidv7 } from './utils/uuid'

/**
 * Browser session identity and its sampling decision, decided ONCE per session
 * and persisted in `sessionStorage` so both survive hard reloads within a tab
 * (Faro's decide-once model). Kept as a pure module - no browser globals at the
 * top level - so the logic is unit-testable in a plain Node context.
 *
 * SHARED by both pipelines. It used to live under `metrics/`, keyed
 * `frogger:metrics:session`, which meant a log emitted during a broken checkout
 * could not be joined to the LCP gauge from the same page load - the two
 * signals had no session in common to join on.
 */

export const SESSION_STORAGE_KEY = 'frogger:session'

/**
 * The pre-0.2 metrics-only key. Read once at boot so an existing tab keeps its
 * session id (and its sampling decision) across the upgrade instead of
 * silently starting a new session mid-visit.
 */
export const LEGACY_METRICS_SESSION_STORAGE_KEY = 'frogger:metrics:session'

export interface FroggerSession {
    id: string
    sampled: boolean
}

/** @deprecated Use {@link FroggerSession}. Kept as an alias for one release. */
export type MetricsSession = FroggerSession

/**
 * Deterministic sampling decision from a rate in `[0, 1]` and a `[0, 1)` random
 * draw. `rate >= 1` always samples, `rate <= 0` never does - so the boundaries
 * never depend on the RNG.
 */
export function decideSampled(sampleRate: number, random: number): boolean {
    if (sampleRate >= 1) return true
    if (sampleRate <= 0) return false
    return random < sampleRate
}

/** Parse a persisted session record, or `null` when absent/corrupt. */
export function parseSession(raw: string | null): FroggerSession | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as unknown
        if (
            parsed && typeof parsed === 'object'
            && typeof (parsed as FroggerSession).id === 'string'
            && typeof (parsed as FroggerSession).sampled === 'boolean'
        ) {
            return parsed as FroggerSession
        }
    }
    catch {
        // corrupt record - treat as absent
    }
    return null
}

/**
 * The session for this tab: an existing one if there is one, otherwise a fresh
 * id with a decide-once sampling verdict.
 *
 * Falls back to an unpersisted session when `sessionStorage` is unavailable
 * (private browsing, a blocked-storage policy, SSR) rather than throwing:
 * losing session continuity is not a reason to lose the signal.
 */
export function resolveSession(sampleRate: number): FroggerSession {
    const fresh = (): FroggerSession => ({
        id: uuidv7(),
        sampled: decideSampled(sampleRate, Math.random()),
    })

    if (typeof sessionStorage === 'undefined') return fresh()

    try {
        const existing = parseSession(sessionStorage.getItem(SESSION_STORAGE_KEY))
            // Carry a pre-0.2 metrics session forward so an open tab is not
            // split into two sessions by the upgrade.
            ?? parseSession(sessionStorage.getItem(LEGACY_METRICS_SESSION_STORAGE_KEY))

        if (existing) {
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(existing))
            return existing
        }

        const session = fresh()
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
        return session
    }
    catch {
        return fresh()
    }
}

/**
 * Validate a client-declared session id arriving over the wire.
 *
 * `x-frogger-session` is unvalidated client input, so it gets the same
 * treatment as a trace id: shape-checked and length-capped before anything
 * indexes on it.
 */
export function parseSessionHeader(value: string | undefined): FroggerSession | undefined {
    if (!value) return undefined

    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > 64) return undefined
    if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return undefined

    // A header-declared session carries no sampling decision of its own; the
    // server treats it as sampled, since it is emitting the row regardless.
    return { id: trimmed, sampled: true }
}
