import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { WebSocketTransport } from '../../src/runtime/logger/_transports/websocket-transport'
import type { LoggerObject } from '../../src/runtime/shared/types/log'

interface FakePeer {
    id: string
    sent: string[]
    /** The transport drops a subscriber whose socket has gone; stub a live one. */
    websocket: object
    send: (payload: string) => void
}

function peer(id: string): FakePeer {
    const sent: string[] = []
    return { id, sent, websocket: {}, send: (payload: string) => { sent.push(payload) } }
}

function makeLog(overrides: Partial<LoggerObject> = {}): LoggerObject {
    return {
        id: `id-${Math.random()}`,
        time: Date.now(),
        lvl: 3,
        sev: 9,
        type: 'info',
        msg: 'row',
        ctx: {},
        env: 'server',
        trace: { traceId: 't', spanId: 's' },
        ...overrides,
    }
}

function fresh(): WebSocketTransport {
    // @ts-expect-error - resetting the module singleton between cases
    WebSocketTransport.instance = null
    return WebSocketTransport.getInstance(null)
}

/** Every log message this peer received, flattened across frames. */
function receivedMessages(p: FakePeer): string[] {
    return p.sent.flatMap((raw) => {
        const parsed = JSON.parse(raw)
        const logs: LoggerObject[] = Array.isArray(parsed?.data) ? parsed.data : []
        return logs.map(l => l.msg)
    })
}

let transport: WebSocketTransport

beforeEach(() => {
    transport = fresh()
})

afterEach(async () => {
    await transport.destroy?.()
    vi.useRealTimers()
})

describe('WebSocketTransport channels and filters', () => {
    it('delivers a batch to a subscribed peer', async () => {
        const p = peer('a')
        await transport.subscribe(p as never, 'main')

        await transport.logBatch([makeLog({ msg: 'hello' })])
        await new Promise(r => setTimeout(r, 0))

        expect(receivedMessages(p)).toEqual(['hello'])
    })

    it('does not deliver to a peer subscribed to a different channel', async () => {
        const a = peer('a')
        const b = peer('b')
        await transport.subscribe(a as never, 'main')
        await transport.subscribe(b as never, 'other')

        // Channels only receive what is broadcast while they have subscribers;
        // both exist, so a row reaches both channels.
        await transport.logBatch([makeLog({ msg: 'x' })])
        await new Promise(r => setTimeout(r, 0))

        expect(receivedMessages(a)).toEqual(['x'])
        expect(receivedMessages(b)).toEqual(['x'])
    })

    it('applies a level filter per subscriber', async () => {
        const quiet = peer('quiet')
        const loud = peer('loud')
        await transport.subscribe(quiet as never, 'main', { level: 'error' })
        await transport.subscribe(loud as never, 'main')

        await transport.logBatch([
            makeLog({ msg: 'info-row', type: 'info', lvl: 3 }),
            makeLog({ msg: 'error-row', type: 'error', lvl: 0 }),
        ])
        await new Promise(r => setTimeout(r, 0))

        expect(receivedMessages(quiet)).toEqual(['error-row'])
        expect(receivedMessages(loud)).toEqual(['info-row', 'error-row'])
    })

    it('rejects a subscription with an unparseable level', async () => {
        const p = peer('bad')
        await expect(transport.subscribe(p as never, 'main', { level: 'nonsense' as never }))
            .resolves.toBe(false)
    })

    it('stops delivering after a subscription is removed', async () => {
        const p = peer('a')
        await transport.subscribe(p as never, 'main')
        await transport.removeSubscription('a')

        await transport.logBatch([makeLog({ msg: 'after' })])
        await new Promise(r => setTimeout(r, 0))

        expect(receivedMessages(p)).toEqual([])
    })
})

describe('WebSocketTransport throttling', () => {
    it('coalesces a throttled burst instead of discarding it', async () => {
        vi.useFakeTimers()
        const p = peer('a')
        await transport.subscribe(p as never, 'main')

        // First batch passes the throttle; the next two land inside the same
        // 100ms window and used to be dropped outright.
        await transport.logBatch([makeLog({ msg: 'first' })])
        await transport.logBatch([makeLog({ msg: 'second' })])
        await transport.logBatch([makeLog({ msg: 'third' })])

        await vi.advanceTimersByTimeAsync(200)

        expect(receivedMessages(p)).toEqual(['first', 'second', 'third'])
    })

    it('replays a coalesced burst as one frame, not one per batch', async () => {
        vi.useFakeTimers()
        const p = peer('a')
        await transport.subscribe(p as never, 'main')

        await transport.logBatch([makeLog({ msg: 'first' })])
        for (let i = 0; i < 5; i++) {
            await transport.logBatch([makeLog({ msg: `held-${i}` })])
        }

        await vi.advanceTimersByTimeAsync(200)

        // One frame for the immediate batch, one for the whole coalesced burst.
        expect(p.sent).toHaveLength(2)
    })

    it('counts rows dropped when a channel buffer overflows', async () => {
        vi.useFakeTimers()
        const p = peer('a')
        await transport.subscribe(p as never, 'main')

        await transport.logBatch([makeLog({ msg: 'first' })])
        // 600 held rows against a 500-row ceiling.
        await transport.logBatch(Array.from({ length: 600 }, (_, i) => makeLog({ msg: `r${i}` })))

        const status = await transport.getStatus()
        expect(status.droppedRows).toBe(100)
        // Oldest go first: a live tail is more useful showing the newest lines.
        expect(status.pendingRows).toBe(500)

        await vi.advanceTimersByTimeAsync(200)
        expect(receivedMessages(p)).toContain('r599')
        expect(receivedMessages(p)).not.toContain('r0')
    })
})
