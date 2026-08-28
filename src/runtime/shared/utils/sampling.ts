import { levelOf } from '../types/log'
import type { LoggerObject } from '../types/log'

/**
 * Sampling configuration.
 *
 * Deliberately separate from `level`. Collapsing the two either loses errors
 * under heavy sampling or fails to control cost at all - the position frogger
 * was in with only a level and a reactive 429. `level` is a hard severity
 * threshold; this is a probabilistic rate with force-keep rules on top.
 */
export interface SamplingOptions {
    /**
     * Fraction of traces to keep, in `[0, 1]`. `1` (the default) keeps
     * everything, so enabling sampling is always an explicit choice.
     */
    rate?: number

    /**
     * Always-keep rules, evaluated BEFORE the rate. Any match wins.
     * @default { errors: true, failedSpans: true }
     */
    keep?: {
        /** Keep any trace containing a warn/error/fatal row. @default true */
        errors?: boolean
        /** Keep any trace containing a failed span. @default true */
        failedSpans?: boolean
        /** Keep any row whose `ctx.forceKeep` is truthy. @default true */
        forceKeep?: boolean
    }
}

export interface ResolvedSampling {
    rate: number
    keep: { errors: boolean, failedSpans: boolean, forceKeep: boolean }
}

export const DEFAULT_SAMPLING: ResolvedSampling = {
    rate: 1,
    keep: { errors: true, failedSpans: true, forceKeep: true },
}

export function resolveSampling(value: SamplingOptions | undefined): ResolvedSampling {
    if (!value) return { ...DEFAULT_SAMPLING, keep: { ...DEFAULT_SAMPLING.keep } }

    return {
        rate: clampRate(value.rate),
        keep: {
            errors: value.keep?.errors ?? true,
            failedSpans: value.keep?.failedSpans ?? true,
            forceKeep: value.keep?.forceKeep ?? true,
        },
    }
}

function clampRate(rate: number | undefined): number {
    if (rate === undefined || Number.isNaN(rate)) return 1
    return Math.min(1, Math.max(0, rate))
}

/**
 * A stable `[0, 1)` value derived from a trace id.
 *
 * This is the load-bearing detail of the whole feature. With a fresh
 * `Math.random()` per side, a client/server hop samples the two halves
 * INDEPENDENTLY and roughly `2 * rate * (1 - rate)` of traces come out
 * half-present - which is worse than not sampling, because a half-trace looks
 * like a dropped request.
 *
 * FNV-1a over the id: cheap, no dependency, and well-distributed enough that
 * the realised rate tracks the configured one.
 */
export function traceHash(traceId: string): number {
    let hash = 0x811c9dc5

    for (let i = 0; i < traceId.length; i++) {
        hash ^= traceId.charCodeAt(i)
        // hash * 16777619, in 32-bit-safe pieces.
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
    }

    return hash / 0x1_0000_0000
}

/** Would this trace be kept on the rate alone, ignoring keep rules? */
export function sampledByRate(traceId: string, rate: number): boolean {
    if (rate >= 1) return true
    if (rate <= 0) return false
    return traceHash(traceId) < rate
}

/** Rows that force their whole unit of work to be kept. */
export function forcesKeep(log: LoggerObject, config: ResolvedSampling): boolean {
    if (config.keep.forceKeep && log.ctx?.forceKeep) return true

    // Anything at warn or above. The entire point of sampling is to shed
    // routine volume, and an error is never routine.
    if (config.keep.errors && log.lvl <= levelOf('warn')) return true

    if (config.keep.failedSpans && log.ctx?.spanEvent === 'end' && log.ctx?.ok === false) return true

    return false
}

/**
 * Decide one completed unit of work.
 *
 * Evaluated per UNIT (a request root span, or an explicit `span()`), never per
 * log line: a per-line decision produces a trace with holes in it, which is
 * unreadable in a way a wholly-absent trace is not.
 */
export function decideBatch(logs: LoggerObject[], config: ResolvedSampling): LoggerObject[] {
    if (config.rate >= 1) return logs
    if (logs.length === 0) return logs

    // One decision per trace, and every row of a kept trace is retained -
    // including the routine ones, which are the context that makes the kept
    // error readable.
    const verdicts = new Map<string, boolean>()

    for (const log of logs) {
        const traceId = log.trace?.traceId
        if (!traceId) continue

        if (verdicts.get(traceId) === true) continue

        if (forcesKeep(log, config)) {
            verdicts.set(traceId, true)
            continue
        }

        if (!verdicts.has(traceId)) {
            verdicts.set(traceId, sampledByRate(traceId, config.rate))
        }
    }

    return logs.filter((log) => {
        const traceId = log.trace?.traceId
        // A row with no trace has no unit to be sampled with; keep it.
        if (!traceId) return true
        return verdicts.get(traceId) !== false
    })
}
