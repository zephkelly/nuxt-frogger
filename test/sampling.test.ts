import { describe, it, expect } from 'vitest'

import {
    resolveSampling,
    traceHash,
    sampledByRate,
    decideBatch,
    DEFAULT_SAMPLING,
} from '../src/runtime/shared/utils/sampling'
import type { LoggerObject } from '../src/runtime/shared/types/log'
import { levelOf, severityOf } from '../src/runtime/shared/types/log'

function row(traceId: string, type = 'info', ctx: Record<string, unknown> = {}): LoggerObject {
    return {
        id: `id-${traceId}-${type}`,
        time: Date.now(),
        lvl: levelOf(type),
        sev: severityOf(type),
        type: type as LoggerObject['type'],
        msg: type,
        ctx,
        env: 'server',
        trace: { traceId, spanId: 's' },
    }
}

const hex = (n: number) => n.toString(16).padStart(32, '0')

describe('resolveSampling', () => {
    it('defaults to keeping everything', () => {
        expect(resolveSampling(undefined)).toEqual(DEFAULT_SAMPLING)
    })

    it('clamps a rate outside [0, 1]', () => {
        expect(resolveSampling({ rate: 5 }).rate).toBe(1)
        expect(resolveSampling({ rate: -1 }).rate).toBe(0)
        expect(resolveSampling({ rate: Number.NaN }).rate).toBe(1)
    })

    it('keeps errors and failed spans unless told otherwise', () => {
        expect(resolveSampling({ rate: 0.1 }).keep).toEqual({
            errors: true, failedSpans: true, forceKeep: true,
        })
    })
})

describe('traceHash', () => {
    it('is deterministic for a given trace id', () => {
        // The load-bearing property: both sides of a client/server hop must
        // reach the SAME verdict, or a fraction of traces come out half-present.
        expect(traceHash('abc')).toBe(traceHash('abc'))
    })

    it('produces a value in [0, 1)', () => {
        for (const id of ['a', 'bb', 'ccc', hex(1), hex(999999)]) {
            const h = traceHash(id)
            expect(h).toBeGreaterThanOrEqual(0)
            expect(h).toBeLessThan(1)
        }
    })

    it('distributes well enough that the realised rate tracks the configured one', () => {
        const ids = Array.from({ length: 4000 }, (_, i) => hex(i))
        const kept = ids.filter(id => sampledByRate(id, 0.25)).length

        expect(kept / ids.length).toBeGreaterThan(0.2)
        expect(kept / ids.length).toBeLessThan(0.3)
    })
})

describe('sampledByRate', () => {
    it('keeps everything at rate 1 and nothing at rate 0', () => {
        expect(sampledByRate('any', 1)).toBe(true)
        expect(sampledByRate('any', 0)).toBe(false)
    })
})

describe('decideBatch', () => {
    const config = resolveSampling({ rate: 0 })

    it('is a no-op at rate 1', () => {
        const logs = [row('t1'), row('t2')]
        expect(decideBatch(logs, resolveSampling({ rate: 1 }))).toBe(logs)
    })

    it('drops a sampled-out trace entirely', () => {
        expect(decideBatch([row('t1'), row('t1')], config)).toHaveLength(0)
    })

    it('always keeps a trace containing an error', () => {
        // Sampling exists to shed routine volume; an error is never routine.
        const kept = decideBatch([row('t1'), row('t1', 'error')], config)
        expect(kept).toHaveLength(2)
    })

    it('keeps the routine rows of a kept trace, which are its context', () => {
        const kept = decideBatch([row('t1', 'info'), row('t1', 'debug'), row('t1', 'error')], config)
        expect(kept.map(l => l.type)).toEqual(['info', 'debug', 'error'])
    })

    it('always keeps a trace containing a failed span', () => {
        const failed = row('t1', 'info', { spanEvent: 'end', ok: false })
        expect(decideBatch([row('t1'), failed], config)).toHaveLength(2)
    })

    it('does not keep a trace whose span succeeded', () => {
        const ok = row('t1', 'info', { spanEvent: 'end', ok: true })
        expect(decideBatch([row('t1'), ok], config)).toHaveLength(0)
    })

    it('honours ctx.forceKeep', () => {
        expect(decideBatch([row('t1', 'info', { forceKeep: true })], config)).toHaveLength(1)
    })

    it('decides each trace independently', () => {
        const kept = decideBatch([row('t1'), row('t2', 'error')], config)
        expect(kept.map(l => l.trace.traceId)).toEqual(['t2'])
    })

    it('keeps a row that carries no trace, since it has no unit to be sampled with', () => {
        const orphan = { ...row('t1'), trace: undefined as unknown as LoggerObject['trace'] }
        expect(decideBatch([orphan], config)).toHaveLength(1)
    })

    it('can be turned off per keep-rule', () => {
        const strict = resolveSampling({ rate: 0, keep: { errors: false, failedSpans: false, forceKeep: false } })
        expect(decideBatch([row('t1', 'error', { forceKeep: true })], strict)).toHaveLength(0)
    })
})
