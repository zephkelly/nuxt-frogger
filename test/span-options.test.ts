import { describe, it, expect } from 'vitest'

import {
    DEFAULT_SPAN_EVENTS,
    spanEventsFromConfig,
} from '../src/runtime/shared/utils/span-events'
import { monotonicNow, elapsedMs, elapsedSeconds } from '../src/runtime/shared/utils/now'

describe('DEFAULT_SPAN_EVENTS', () => {
    it('emits rows at info and records no duration metric', () => {
        expect(DEFAULT_SPAN_EVENTS).toEqual({ level: 'info', metric: false })
    })
})

describe('spanEventsFromConfig', () => {
    it('false disables span events entirely', () => {
        expect(spanEventsFromConfig(false)).toBe(false)
    })

    it('falls back to the default when the key is absent', () => {
        expect(spanEventsFromConfig(undefined)).toEqual({ level: 'info', metric: false })
    })

    it('reads a fully resolved value through unchanged', () => {
        expect(spanEventsFromConfig({ level: 'debug', metric: true }))
            .toEqual({ level: 'debug', metric: true })
    })

    it('defaults metric to false for a config written before it existed', () => {
        expect(spanEventsFromConfig({ level: 'debug' })).toEqual({ level: 'debug', metric: false })
    })

    it('defaults the level when only metric is set', () => {
        expect(spanEventsFromConfig({ metric: true })).toEqual({ level: 'info', metric: true })
    })

    it('supports the histogram-without-log-volume shape', () => {
        // The row is pinned below a level-3 logger and filtered before any
        // transport; the metric is unaffected.
        expect(spanEventsFromConfig({ level: 'debug', metric: true }))
            .toMatchObject({ level: 'debug', metric: true })
    })

    it('does not return the shared default object, which callers could mutate', () => {
        const a = spanEventsFromConfig(undefined)

        expect(a).not.toBe(DEFAULT_SPAN_EVENTS)
    })
})

describe('monotonic clock', () => {
    it('advances', async () => {
        const start = monotonicNow()
        await new Promise(resolve => setTimeout(resolve, 5))

        expect(monotonicNow()).toBeGreaterThan(start)
    })

    it('elapsedMs is never negative and is rounded to microseconds', async () => {
        const start = monotonicNow()
        await new Promise(resolve => setTimeout(resolve, 5))
        const elapsed = elapsedMs(start)

        expect(elapsed).toBeGreaterThanOrEqual(0)
        expect(elapsed).toBe(Math.round(elapsed * 1000) / 1000)
    })

    it('elapsedSeconds reports the metric base unit', () => {
        const start = monotonicNow() - 1000

        // Each call re-reads the clock, so compare against the known offset
        // rather than against a second reading.
        expect(elapsedSeconds(start)).toBeCloseTo(1, 2)
    })

    it('measures a sub-millisecond duration as more than zero', () => {
        const start = monotonicNow()
        let n = 0
        for (let i = 0; i < 1000; i++) n += i

        expect(n).toBeGreaterThan(0)
        // Date.now() would round this to 0; performance.now() does not.
        expect(elapsedMs(start)).toBeGreaterThan(0)
    })
})
