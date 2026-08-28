import type { LogType } from 'consola'

import type { IFroggerTransport } from './types'
import type { LoggerObject } from '../../shared/types/log'
import { levelOf } from '../../shared/types/log'

/**
 * Wrap a transport so it only sees records at or above `minLevel`.
 *
 * This is pino's two-stage gate: the logger decides what a record even is, and
 * each destination decides what it wants. Without it, "warn and above to the
 * HTTP sink, everything to the file" was inexpressible - the only knob was a
 * process-wide exact-membership `levels: number[]` on a single batch transport.
 *
 * A decorator rather than a field on every transport: filtering is not any
 * individual sink's concern, and doing it here means a user-authored transport
 * gets `minLevel` for free without implementing anything.
 */
export function withMinLevel(transport: IFroggerTransport, minLevel: LogType | undefined): IFroggerTransport {
    if (!minLevel) return transport

    // Frogger levels ascend with verbosity, so "at least this important" is
    // `lvl <= threshold`.
    const threshold = levelOf(minLevel)
    const admits = (log: LoggerObject) => log.lvl <= threshold

    return {
        name: transport.name,
        transportId: transport.transportId,

        log(logObj: LoggerObject) {
            if (!admits(logObj)) return
            return transport.log(logObj)
        },

        logBatch(logs: LoggerObject[]) {
            const admitted = logs.filter(admits)
            if (admitted.length === 0) return
            return transport.logBatch(admitted)
        },

        // Lifecycle passes straight through: a filtered transport still has to
        // be flushed and destroyed like any other.
        flush: transport.flush ? () => transport.flush!() : undefined,
        forceFlush: transport.forceFlush ? () => transport.forceFlush!() : undefined,
        destroy: transport.destroy ? () => transport.destroy!() : undefined,
    }
}
