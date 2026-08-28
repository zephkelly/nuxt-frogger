import { describe, it, expect, vi } from 'vitest'

import { withMinLevel } from '../../src/runtime/logger/_transports/level-gate'
import type { IFroggerTransport } from '../../src/runtime/logger/_transports/types'
import type { LoggerObject } from '../../src/runtime/shared/types/log'
import { levelOf, severityOf } from '../../src/runtime/shared/types/log'

function row(type: string, msg = type): LoggerObject {
    return {
        id: `id-${msg}`,
        time: Date.now(),
        lvl: levelOf(type),
        sev: severityOf(type),
        type: type as LoggerObject['type'],
        msg,
        ctx: {},
        env: 'server',
        trace: { traceId: 't', spanId: 's' },
    }
}

function sink() {
    const seen: string[] = []
    const transport: IFroggerTransport = {
        name: 'test',
        transportId: 'test-1',
        log: (l) => { seen.push(l.msg) },
        logBatch: (logs) => { for (const l of logs) seen.push(l.msg) },
        flush: vi.fn(),
        forceFlush: vi.fn(),
        destroy: vi.fn(),
    }
    return { seen, transport }
}

describe('withMinLevel', () => {
    it('returns the transport untouched when no threshold is set', () => {
        const { transport } = sink()
        expect(withMinLevel(transport, undefined)).toBe(transport)
    })

    it('admits records at or above the threshold', () => {
        // Frogger levels ascend with verbosity, so "warn and above" is lvl <= 1.
        const { seen, transport } = sink()
        const gated = withMinLevel(transport, 'warn')

        gated.logBatch([row('error'), row('warn'), row('info'), row('debug')])

        expect(seen).toEqual(['error', 'warn'])
    })

    it('gates the single-record path too', () => {
        const { seen, transport } = sink()
        const gated = withMinLevel(transport, 'error')

        gated.log(row('info'))
        gated.log(row('fatal'))

        expect(seen).toEqual(['fatal'])
    })

    it('skips the downstream call entirely when nothing is admitted', () => {
        const inner = { ...sink().transport, logBatch: vi.fn() }
        const gated = withMinLevel(inner, 'error')

        gated.logBatch([row('info'), row('debug')])

        expect(inner.logBatch).not.toHaveBeenCalled()
    })

    it('lets everything through at the most verbose threshold', () => {
        const { seen, transport } = sink()
        const gated = withMinLevel(transport, 'trace')

        gated.logBatch([row('fatal'), row('info'), row('trace')])

        expect(seen).toEqual(['fatal', 'info', 'trace'])
    })

    it('passes lifecycle calls straight through', async () => {
        const { transport } = sink()
        const gated = withMinLevel(transport, 'warn')

        await gated.flush?.()
        await gated.forceFlush?.()
        await gated.destroy?.()

        expect(transport.flush).toHaveBeenCalled()
        expect(transport.forceFlush).toHaveBeenCalled()
        expect(transport.destroy).toHaveBeenCalled()
    })
})

describe('StdoutTransport', () => {
    it('writes one JSON line per record', async () => {
        const { StdoutTransport } = await import('../../src/runtime/logger/_transports/stdout-transport')
        const written: string[] = []
        const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            written.push(String(chunk))
            return true
        })

        const transport = new StdoutTransport()
        transport.log(row('info', 'hello'))

        expect(written).toHaveLength(1)
        expect(JSON.parse(written[0]!.trim()).msg).toBe('hello')
        write.mockRestore()
    })

    it('writes a batch as one call, not one syscall per row', async () => {
        const { StdoutTransport } = await import('../../src/runtime/logger/_transports/stdout-transport')
        const written: string[] = []
        const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            written.push(String(chunk))
            return true
        })

        new StdoutTransport().logBatch([row('info', 'a'), row('warn', 'b'), row('error', 'c')])

        expect(written).toHaveLength(1)
        expect(written[0]!.trim().split('\n').map(l => JSON.parse(l).msg)).toEqual(['a', 'b', 'c'])
        write.mockRestore()
    })

    it('writes nothing for an empty batch', async () => {
        const { StdoutTransport } = await import('../../src/runtime/logger/_transports/stdout-transport')
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

        new StdoutTransport().logBatch([])

        expect(write).not.toHaveBeenCalled()
        write.mockRestore()
    })
})
