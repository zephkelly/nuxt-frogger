import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { runSpanWithEvent, type ResolvedSpanEvents } from '../../src/runtime/shared/utils/span-events'
import { setSpanMetricSink, getSpanMetricSink } from '../../src/runtime/shared/utils/span-metric-sink'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

function fakeChild() {
    return { logLevel: vi.fn() } as unknown as IFroggerLogger
}

const AT_INFO: ResolvedSpanEvents = { level: 'info', metric: false }

describe('span metric sink registry', () => {
    afterEach(() => setSpanMetricSink(null))

    it('is null until the metrics subsystem registers one', () => {
        expect(getSpanMetricSink()).toBeNull()
    })

    it('returns the registered sink and clears on null', () => {
        const sink = vi.fn()
        setSpanMetricSink(sink)
        expect(getSpanMetricSink()).toBe(sink)

        setSpanMetricSink(null)
        expect(getSpanMetricSink()).toBeNull()
    })
})

describe('runSpanWithEvent onEnd', () => {
    let child: IFroggerLogger

    beforeEach(() => {
        child = fakeChild()
    })

    it('reports the duration in seconds with ok true on success', async () => {
        const onEnd = vi.fn()

        await runSpanWithEvent(child, 'checkout', AT_INFO, async () => 'ok', onEnd)

        expect(onEnd).toHaveBeenCalledTimes(1)
        const [seconds, ok] = onEnd.mock.calls[0]!
        expect(ok).toBe(true)
        expect(seconds).toBeGreaterThanOrEqual(0)
        expect(seconds).toBeLessThan(5)
    })

    it('reports ok false and still rethrows', async () => {
        const onEnd = vi.fn()
        const boom = new Error('boom')

        await expect(
            runSpanWithEvent(child, 'checkout', AT_INFO, async () => { throw boom }, onEnd),
        ).rejects.toBe(boom)

        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd.mock.calls[0]![1]).toBe(false)
    })

    it('runs the timer even when span-end rows are disabled', async () => {
        const onEnd = vi.fn()

        await runSpanWithEvent(child, 'checkout', false, async () => 'ok', onEnd)

        expect(child.logLevel).not.toHaveBeenCalled()
        expect(onEnd).toHaveBeenCalledTimes(1)
    })

    it('skips the timer entirely when nothing would consume it', async () => {
        const result = await runSpanWithEvent(child, 'checkout', false, async () => 'ok')

        expect(result).toBe('ok')
        expect(child.logLevel).not.toHaveBeenCalled()
    })

    it('still emits the span-end row alongside the metric', async () => {
        await runSpanWithEvent(child, 'checkout', AT_INFO, async () => 'ok', vi.fn())

        expect(child.logLevel).toHaveBeenCalledWith(
            'info',
            'checkout',
            expect.objectContaining({ spanEvent: 'end', ok: true }),
        )
    })

    it('a throwing sink never breaks the span it measures', async () => {
        const onEnd = vi.fn(() => { throw new Error('sink exploded') })

        await expect(
            runSpanWithEvent(child, 'checkout', AT_INFO, async () => 'ok', onEnd),
        ).resolves.toBe('ok')
    })
})
