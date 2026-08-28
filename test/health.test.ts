import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
    getFroggerHealth,
    resetFroggerHealth,
    recordEnqueued,
    recordDelivered,
    recordDropped,
    recordPipelineError,
} from '../src/runtime/shared/utils/health'

beforeEach(() => {
    resetFroggerHealth()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('frogger health counters', () => {
    it('starts at zero on every axis', () => {
        expect(getFroggerHealth()).toEqual({
            enqueued: 0,
            delivered: 0,
            dropped: {
                overflow: 0,
                rateLimited: 0,
                rejected4xx: 0,
                retriesExhausted: 0,
                pipelineError: 0,
            },
            lastError: undefined,
            lastErrorAt: undefined,
        })
    })

    it('counts enqueued and delivered records', () => {
        recordEnqueued(5)
        recordDelivered(3)

        const health = getFroggerHealth()
        expect(health.enqueued).toBe(5)
        expect(health.delivered).toBe(3)
    })

    it('counts each drop reason separately', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        recordDropped('overflow', 10)
        recordDropped('rejected4xx', 2)
        recordDropped('rateLimited', 1)

        expect(getFroggerHealth().dropped).toMatchObject({
            overflow: 10,
            rejected4xx: 2,
            rateLimited: 1,
            retriesExhausted: 0,
        })
    })

    it('announces the first drop on the ungated channel, then stays quiet', () => {
        // A misconfigured ingest key discards 100% of production logs, and the
        // level-gated channel is silent in production - so the first drop must
        // print regardless of the configured level.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        recordDropped('rejected4xx', 100, 'ingest rejected the batch (401)')
        recordDropped('rejected4xx', 100, 'ingest rejected the batch (401)')
        recordDropped('overflow', 5)

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]!.join(' ')).toContain('rejected4xx')
    })

    it('records the last error and when it happened', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        recordDropped('retriesExhausted', 3, 'https://ingest.example.com failed after 3 retries')

        const health = getFroggerHealth()
        expect(health.lastError).toContain('failed after 3 retries')
        expect(typeof health.lastErrorAt).toBe('number')
    })

    it('counts an exception inside the pipeline as a lost record', () => {
        recordPipelineError(new Error('reporter blew up'))

        const health = getFroggerHealth()
        expect(health.dropped.pipelineError).toBe(1)
        expect(health.lastError).toBe('reporter blew up')
    })

    it('ignores a non-positive drop count', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        recordDropped('overflow', 0)

        expect(getFroggerHealth().dropped.overflow).toBe(0)
        expect(warn).not.toHaveBeenCalled()
    })

    it('returns a snapshot, not a live reference', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const before = getFroggerHealth()
        recordDropped('overflow', 7)

        expect(before.dropped.overflow).toBe(0)
        expect(getFroggerHealth().dropped.overflow).toBe(7)
    })
})
