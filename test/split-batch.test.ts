import { describe, it, expect } from 'vitest';

import { splitLoggerBatch } from '../src/runtime/shared/utils/split-batch';
import type { LoggerObjectBatch } from '../src/runtime/shared/types/batch';
import type { LoggerObject } from '../src/runtime/shared/types/log';

function makeLog(msg = 'x'): LoggerObject {
    return {
        time: 1, lvl: 3, type: 'log', msg, ctx: {}, env: 'test',
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    } as unknown as LoggerObject;
}

function makeBatch(count: number, msg = 'x'): LoggerObjectBatch {
    return {
        logs: Array.from({ length: count }, () => makeLog(msg)),
        app: { name: 'app', version: '1' },
        meta: { time: 1, processChain: ['app'] },
    };
}

describe('splitLoggerBatch', () => {
    it('returns the batch unchanged when no caps are set', () => {
        const batch = makeBatch(3);
        const chunks = splitLoggerBatch(batch);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(batch);
    });

    it('returns the batch unchanged for an empty batch', () => {
        const batch = makeBatch(0);
        expect(splitLoggerBatch(batch, { maxEvents: 10 })).toEqual([batch]);
    });

    it('splits by event count', () => {
        const chunks = splitLoggerBatch(makeBatch(10), { maxEvents: 4 });
        expect(chunks.map(c => c.logs.length)).toEqual([4, 4, 2]);
    });

    it('respects an exact count boundary', () => {
        const chunks = splitLoggerBatch(makeBatch(8), { maxEvents: 4 });
        expect(chunks.map(c => c.logs.length)).toEqual([4, 4]);
    });

    it('carries app, resource and meta onto every chunk', () => {
        // Chunks are all the same hop, so they must carry the same schema
        // version, resource block and process chain as the batch they came from.
        const source = makeBatch(5);
        source.resource = { 'service.name': 'app', 'deployment.environment': 'test' };
        source.meta = { schema: 'frogger.logs/1', time: 123, processChain: ['a'] };

        const chunks = splitLoggerBatch(source, { maxEvents: 2 });
        for (const chunk of chunks) {
            expect(chunk.app).toEqual({ name: 'app', version: '1' });
            expect(chunk.resource).toEqual(source.resource);
            expect(chunk.meta).toEqual(source.meta);
        }
    });

    it('splits by byte size when a single log fits but two do not', () => {
        // Each log JSON is well over 100 bytes, so a ~250-byte budget takes one per chunk.
        const chunks = splitLoggerBatch(makeBatch(4, 'y'), { maxBytes: 350 });
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.logs.length).toBeGreaterThanOrEqual(1);
        }
    });

    it('keeps a single oversize log in its own chunk rather than dropping it', () => {
        const big = makeBatch(1, 'z'.repeat(5000));
        const chunks = splitLoggerBatch(big, { maxBytes: 500 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.logs).toHaveLength(1);
    });

    it('applies the count cap before the byte cap', () => {
        const chunks = splitLoggerBatch(makeBatch(6), { maxEvents: 2, maxBytes: 10 * 1024 });
        expect(chunks.map(c => c.logs.length)).toEqual([2, 2, 2]);
    });
});
