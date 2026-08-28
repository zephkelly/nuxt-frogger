import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'
import { uuidv7 } from '../../shared/utils/uuid'

/** Ceilings the ingest route enforces on a client-declared batch. */
export const INGEST_LIMITS = {
    maxLogsPerBatch: 1000,
    maxMessageBytes: 32 * 1024,
    /** How far in the past a claimed `time` may sit before it is clamped. */
    maxClockSkewPastMs: 24 * 60 * 60 * 1000,
    /** How far in the future a claimed `time` may sit before it is clamped. */
    maxClockSkewFutureMs: 5 * 60 * 1000,
} as const

export interface BatchValidationFailure {
    code: string
    message: string
}

export type BatchValidationResult =
    | { ok: true; batch: LoggerObjectBatch }
    | { ok: false; failure: BatchValidationFailure }

const fail = (code: string, message: string): BatchValidationResult => ({
    ok: false,
    failure: { code, message },
})

/**
 * Validate and normalise an inbound log batch.
 *
 * Hand-rolled rather than schema-library-backed: the shape is small, the rules
 * are the ones a downstream ingest would apply anyway, and adding a dependency
 * to a collection package for eight checks is not worth the bundle.
 *
 * Anything that fails is a 400 with a stable code, never a 500: an unparseable
 * row must not be able to take the route down. `time` is clamped rather than
 * rejected - a phone whose clock woke up wrong still produced a real log.
 */
export function validateLogBatch(
    input: unknown,
    now: number = Date.now(),
): BatchValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return fail('FROGGER_BAD_BATCH', 'Body must be a log batch object')
    }

    const batch = input as LoggerObjectBatch

    if (!Array.isArray(batch.logs)) {
        return fail('FROGGER_BAD_BATCH', '`logs` must be an array')
    }

    if (batch.logs.length > INGEST_LIMITS.maxLogsPerBatch) {
        return fail(
            'FROGGER_BATCH_TOO_LARGE',
            `A batch carries at most ${INGEST_LIMITS.maxLogsPerBatch} logs (got ${batch.logs.length})`,
        )
    }

    const minTime = now - INGEST_LIMITS.maxClockSkewPastMs
    const maxTime = now + INGEST_LIMITS.maxClockSkewFutureMs

    for (let i = 0; i < batch.logs.length; i++) {
        const log = batch.logs[i] as LoggerObject | undefined

        if (!log || typeof log !== 'object' || Array.isArray(log)) {
            return fail('FROGGER_BAD_LOG', `logs[${i}] is not an object`)
        }

        if (typeof log.time !== 'number' || !Number.isFinite(log.time)) {
            return fail('FROGGER_BAD_LOG', `logs[${i}].time must be a finite number`)
        }

        if (typeof log.lvl !== 'number' || !Number.isFinite(log.lvl)) {
            return fail('FROGGER_BAD_LOG', `logs[${i}].lvl must be a finite number`)
        }

        if (log.msg !== undefined && typeof log.msg !== 'string') {
            return fail('FROGGER_BAD_LOG', `logs[${i}].msg must be a string`)
        }

        if (log.ctx !== undefined && (typeof log.ctx !== 'object' || log.ctx === null || Array.isArray(log.ctx))) {
            return fail('FROGGER_BAD_LOG', `logs[${i}].ctx must be an object`)
        }

        if (typeof log.msg === 'string' && log.msg.length > INGEST_LIMITS.maxMessageBytes) {
            log.msg = log.msg.slice(0, INGEST_LIMITS.maxMessageBytes) + '…[truncated]'
        }

        // A skewed emitter clock otherwise sorts a row into the wrong place
        // forever, and a future-dated row never becomes flush-eligible in
        // BatchTransport's time-keyed window.
        log.time = Math.min(Math.max(log.time, minTime), maxTime)

        // An inbound row without an id predates R2 or came from a non-frogger
        // emitter; mint one so every stored record is addressable.
        if (typeof log.id !== 'string' || log.id.length === 0) {
            log.id = uuidv7()
        }
    }

    return { ok: true, batch }
}
