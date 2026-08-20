import type { LogType } from 'consola'

import type { IFroggerLogger } from '../../logger/types'

/**
 * Resolved `spans` module option: `false` disables span-end events, otherwise
 * the level they are emitted at.
 */
export type ResolvedSpanEvents = false | { level: LogType }

export const DEFAULT_SPAN_EVENTS: ResolvedSpanEvents = { level: 'info' }

/**
 * Run a `span()` body and emit one span-end event on the span's child logger,
 * OTel-style: every span produces exactly one row carrying its duration and
 * ok/error status, so a span is visible even when nothing logs inside it.
 *
 * The thrown error itself is NOT attached: it propagates to the caller, whose
 * handler (or the global error capture) owns reporting it. `ok: false` plus
 * the shared trace is enough to correlate the two rows.
 */
export async function runSpanWithEvent<T>(
    child: IFroggerLogger,
    name: string,
    spanEvents: ResolvedSpanEvents,
    run: () => Promise<T>,
): Promise<T> {
    if (!spanEvents) {
        return run()
    }

    const start = Date.now()
    try {
        const result = await run()
        child.logLevel(spanEvents.level, name, { spanEvent: 'end', durationMs: Date.now() - start, ok: true })
        return result
    }
    catch (error) {
        child.logLevel(spanEvents.level, name, { spanEvent: 'end', durationMs: Date.now() - start, ok: false })
        throw error
    }
}
