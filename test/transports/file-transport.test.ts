import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileTransport } from '../../src/runtime/logger/_transports/file-transport'
import type { LoggerObject } from '../../src/runtime/shared/types/log'
import { resetOnceEmitted } from '../../src/runtime/shared/utils/internal-log'

let directory: string

function makeLog(msg: string): LoggerObject {
    return {
        id: `id-${msg}`,
        time: Date.now(),
        lvl: 3,
        sev: 9,
        type: 'info',
        msg,
        ctx: {},
        env: 'server',
        trace: { traceId: 't', spanId: 's' },
    }
}

async function readAll(dir: string): Promise<Record<string, string>> {
    const files = await readdir(dir)
    const out: Record<string, string> = {}
    for (const f of files) {
        out[f] = await readFile(join(dir, f), 'utf8')
    }
    return out
}

const lines = (content: string) => content.trim().split('\n').filter(Boolean)

describe('FileTransport rotation', () => {
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'frogger-file-'))
        resetOnceEmitted()
    })

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true })
        vi.restoreAllMocks()
    })

    it('keeps writing to the current file after a size rotation', async () => {
        // Small cap so the second batch trips rotation.
        const transport = new FileTransport({ directory, maxSize: 200, fileNameFormat: 'app.log' })

        await transport.logBatch([makeLog('first')])
        await transport.logBatch([makeLog('second-batch-that-crosses-the-cap')])
        await transport.logBatch([makeLog('third')])
        await transport.forceFlush()

        const files = await readAll(directory)
        const names = Object.keys(files).sort()

        // One rotated file plus the live one.
        expect(names).toContain('app.log')
        expect(names.length).toBeGreaterThan(1)

        // The regression: post-rotation writes must land in app.log, not in the
        // renamed file through a still-open descriptor.
        expect(files['app.log']).toContain('third')

        const everything = Object.values(files).join('\n')
        expect(everything).toContain('first')
        expect(everything).toContain('second-batch-that-crosses-the-cap')
        expect(everything).toContain('third')
    })

    it('rotates more than once instead of silently becoming a no-op', async () => {
        const transport = new FileTransport({ directory, maxSize: 150, fileNameFormat: 'app.log' })

        for (let i = 0; i < 6; i++) {
            await transport.logBatch([makeLog(`row-${i}-padding-to-cross-the-small-cap`)])
        }
        await transport.forceFlush()

        const files = await readAll(directory)
        const rotated = Object.keys(files).filter(n => n !== 'app.log')

        // The old `existsSync` guard made every rotation after the first a
        // no-op, so exactly one rotated file ever appeared.
        expect(rotated.length).toBeGreaterThan(1)

        const stored = Object.values(files).flatMap(lines).map(l => JSON.parse(l).msg)
        expect(stored).toHaveLength(6)
    })

    it('loses no lines across a rotation', async () => {
        const transport = new FileTransport({ directory, maxSize: 300, fileNameFormat: 'app.log' })

        const expected = Array.from({ length: 25 }, (_, i) => `line-${i}`)
        for (const msg of expected) {
            await transport.logBatch([makeLog(msg)])
        }
        await transport.forceFlush()

        const files = await readAll(directory)
        const stored = Object.values(files).flatMap(lines).map(l => JSON.parse(l).msg)
        expect(stored.sort()).toEqual([...expected].sort())
    })

    it('starts a new file when the date-based name changes', async () => {
        const transport = new FileTransport({ directory, maxSize: 10 ** 9, fileNameFormat: 'YYYY-MM-DD.log' })

        const day1 = new Date('2026-03-01T10:00:00Z')
        vi.useFakeTimers()
        try {
            vi.setSystemTime(day1)
            await transport.logBatch([makeLog('monday')])

            vi.setSystemTime(new Date('2026-03-02T10:00:00Z'))
            await transport.logBatch([makeLog('tuesday')])
            await transport.forceFlush()
        }
        finally {
            vi.useRealTimers()
        }

        const files = await readAll(directory)
        expect(Object.keys(files).sort()).toEqual(['2026-03-01.log', '2026-03-02.log'])
        expect(files['2026-03-01.log']).toContain('monday')
        expect(files['2026-03-02.log']).toContain('tuesday')
    })

    it('degrades and announces once when the filesystem refuses writes', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const transport = new FileTransport({ directory, fileNameFormat: 'app.log' })

        // Reach the private handler the stream's `error` event feeds. It lives
        // on the shared FileSink the transport owns.
        const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
        const sink = (transport as unknown as { sink: { handleStreamError(e: unknown): void } }).sink
        sink.handleStreamError(enospc)
        sink.handleStreamError(enospc)

        expect(transport.isDegraded()).toBe(true)
        // Ungated (so it survives the production-silent internal level) and
        // emitted exactly once, so a failing disk cannot become the noise.
        expect(errorSpy).toHaveBeenCalledTimes(1)

        await transport.log(makeLog('dropped'))
        expect((sink as unknown as { buffer: string[] }).buffer).toHaveLength(0)
    })
})
