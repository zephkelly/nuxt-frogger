import { describe, it, expect, vi, afterEach } from 'vitest'

import { backoffDelay, retryAfterMs } from '../src/runtime/shared/utils/backoff'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('backoffDelay', () => {
    it('doubles the window per attempt', () => {
        expect(backoffDelay(0, { baseMs: 1000, jitter: false })).toBe(1000)
        expect(backoffDelay(1, { baseMs: 1000, jitter: false })).toBe(2000)
        expect(backoffDelay(3, { baseMs: 1000, jitter: false })).toBe(8000)
    })

    it('caps the window', () => {
        expect(backoffDelay(20, { baseMs: 1000, maxMs: 30_000, jitter: false })).toBe(30_000)
    })

    it('treats a negative attempt as the first', () => {
        expect(backoffDelay(-3, { baseMs: 1000, jitter: false })).toBe(1000)
    })

    it('spreads retries across the whole window by default', () => {
        // Full jitter, not a wobble: without it every instance behind a load
        // balancer retries a recovering sink at the same instant, and its first
        // moment of recovery is the next thundering herd.
        const draws = Array.from({ length: 200 }, () => backoffDelay(3, { baseMs: 1000 }))

        expect(Math.min(...draws)).toBeLessThan(2000)
        expect(Math.max(...draws)).toBeGreaterThan(6000)
        for (const d of draws) {
            expect(d).toBeGreaterThanOrEqual(0)
            expect(d).toBeLessThanOrEqual(8000)
        }
    })
})

describe('retryAfterMs', () => {
    const withHeader = (value: string | null) => ({
        response: { headers: { get: () => value } },
    })

    it('reads a seconds value', () => {
        expect(retryAfterMs(withHeader('30'))).toBe(30_000)
    })

    it('reads an HTTP-date value', () => {
        const future = new Date(Date.now() + 60_000).toUTCString()
        const ms = retryAfterMs(withHeader(future))!
        expect(ms).toBeGreaterThan(50_000)
        expect(ms).toBeLessThanOrEqual(60_000)
    })

    it('never returns a negative delay for a past date', () => {
        const past = new Date(Date.now() - 60_000).toUTCString()
        expect(retryAfterMs(withHeader(past))).toBe(0)
    })

    it('returns undefined when there is no usable header', () => {
        expect(retryAfterMs(withHeader(null))).toBeUndefined()
        expect(retryAfterMs(withHeader('soon'))).toBeUndefined()
        expect(retryAfterMs({})).toBeUndefined()
        expect(retryAfterMs(undefined)).toBeUndefined()
    })
})
