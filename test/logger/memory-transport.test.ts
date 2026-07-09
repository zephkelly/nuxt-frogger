import { describe, it, expect, beforeEach } from 'vitest'

import {
    MemoryTransport,
    getMemoryStore,
    clearMemoryStore,
} from '../../src/runtime/logger/_transports/memory-transport'
import { filterLogs } from '../../src/testing'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

function makeLog(overrides: Partial<LoggerObject> = {}): LoggerObject {
    return {
        time: 0,
        lvl: 3,
        type: 'info',
        msg: 'hello',
        ctx: {},
        env: 'server',
        trace: { traceId: 'trace-a', spanId: 'span-a' },
        ...overrides,
    }
}

beforeEach(() => {
    clearMemoryStore()
})

describe('MemoryTransport', () => {
    it('captures individual logs via log()', () => {
        const t = new MemoryTransport()
        t.log(makeLog({ msg: 'one' }))
        t.log(makeLog({ msg: 'two' }))

        expect(t.size).toBe(2)
        expect(t.getLogs().map(l => l.msg)).toEqual(['one', 'two'])
    })

    it('captures a batch via logBatch()', () => {
        const t = new MemoryTransport()
        t.logBatch([makeLog({ msg: 'a' }), makeLog({ msg: 'b' })])

        expect(t.getLogs().map(l => l.msg)).toEqual(['a', 'b'])
    })

    it('clear() empties the captured logs', () => {
        const t = new MemoryTransport()
        t.log(makeLog())
        expect(t.size).toBe(1)

        t.clear()
        expect(t.size).toBe(0)
        expect(t.getLogs()).toEqual([])
    })

    it('flush() is a no-op that resolves', async () => {
        const t = new MemoryTransport()
        await expect(t.flush()).resolves.toBeUndefined()
    })

    it('named instances share one registry array', () => {
        const a = new MemoryTransport({ name: 'shared' })
        const b = new MemoryTransport({ name: 'shared' })

        a.log(makeLog({ msg: 'from-a' }))
        b.log(makeLog({ msg: 'from-b' }))

        expect(a.getLogs().map(l => l.msg)).toEqual(['from-a', 'from-b'])
        expect(b.getLogs().map(l => l.msg)).toEqual(['from-a', 'from-b'])
        expect(getMemoryStore('shared')).toHaveLength(2)
    })

    it('unnamed instances keep private arrays', () => {
        const a = new MemoryTransport()
        const b = new MemoryTransport()

        a.log(makeLog({ msg: 'only-a' }))

        expect(a.size).toBe(1)
        expect(b.size).toBe(0)
    })

    it('clearMemoryStore(name) empties only that store, in place', () => {
        const a = new MemoryTransport({ name: 'x' })
        new MemoryTransport({ name: 'y' }).log(makeLog())
        a.log(makeLog())

        clearMemoryStore('x')
        expect(a.size).toBe(0)
        expect(getMemoryStore('y')).toHaveLength(1)
    })
})

describe('filterLogs', () => {
    const logs: LoggerObject[] = [
        makeLog({ lvl: 1, type: 'warn', msg: 'disk almost full, redeploy soon' }),
        makeLog({ lvl: 0, type: 'error', msg: 'boom', trace: { traceId: 'trace-b', spanId: 's' } }),
        makeLog({ lvl: 3, type: 'info', msg: 'user signed in', ctx: { userId: 42 } }),
    ]

    it('filters by level name', () => {
        expect(filterLogs(logs, { level: 'warn' }).map(l => l.msg)).toEqual([
            'disk almost full, redeploy soon',
        ])
    })

    it('filters by numeric level', () => {
        expect(filterLogs(logs, { level: 0 }).map(l => l.type)).toEqual(['error'])
    })

    it('filters by type', () => {
        expect(filterLogs(logs, { type: 'info' }).map(l => l.msg)).toEqual(['user signed in'])
    })

    it('filters by msg substring and regex', () => {
        expect(filterLogs(logs, { msg: 'redeploy' })).toHaveLength(1)
        expect(filterLogs(logs, { msg: /signed in/ })).toHaveLength(1)
    })

    it('filters by ctx subset', () => {
        expect(filterLogs(logs, { ctx: { userId: 42 } })).toHaveLength(1)
        expect(filterLogs(logs, { ctx: { userId: 99 } })).toHaveLength(0)
    })

    it('filters by traceId', () => {
        expect(filterLogs(logs, { traceId: 'trace-b' }).map(l => l.msg)).toEqual(['boom'])
    })

    it('ANDs multiple predicates', () => {
        expect(filterLogs(logs, { level: 'warn', msg: /redeploy/ })).toHaveLength(1)
        expect(filterLogs(logs, { level: 'warn', msg: /nope/ })).toHaveLength(0)
    })
})
