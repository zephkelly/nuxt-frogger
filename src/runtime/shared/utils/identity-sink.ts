/**
 * Receives the acting user whenever `frogger.identify()` is called.
 *
 * Registered by the metrics subsystem at plugin init, called by the client
 * logger. The indirection is the same one `span-metric-sink` uses and exists
 * for the same reason: the logger tree must not import the metrics tree, and
 * the metrics subsystem is opt-in, so a bare install must not pull it into the
 * bundle. A null sink is the normal state, not an error.
 *
 * Without this, identifying a user for logs and identifying them for metrics
 * would be two separate calls that can disagree.
 */
export type IdentitySink = (user: string | undefined) => void

let sink: IdentitySink | null = null

export function setIdentitySink(fn: IdentitySink | null): void {
    sink = fn
}

export function notifyIdentity(user: string | undefined): void {
    if (!sink) return

    try {
        sink(user)
    }
    catch {
        // Identifying a user must never break the code doing the identifying.
    }
}
