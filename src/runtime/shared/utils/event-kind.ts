import { EVENT_MARKER } from '../../logger/base-frogger'

/**
 * Lift `frogger.event()`'s internal marker off the context object and onto the
 * row's top-level `kind`, deleting it on the way.
 *
 * The marker travels through consola's args as a symbol key so it cannot
 * collide with a user context key and cannot be forged by an inbound JSON
 * batch; this is where it stops being an implementation detail and becomes the
 * wire field a reader indexes on.
 */
export function eventKind(context: unknown): { kind?: 'event' } {
    if (!context || typeof context !== 'object') return {}

    const record = context as Record<PropertyKey, unknown>
    if (record[EVENT_MARKER] !== true) return {}

    delete record[EVENT_MARKER]
    return { kind: 'event' }
}
