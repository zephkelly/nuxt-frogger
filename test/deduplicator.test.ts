import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LogDeduplicator } from '../src/runtime/websocket/deduplicator';
import type { LoggerObject } from '../src/runtime/shared/types/log';



describe('LogDeduplicator', () => {
    let manager: LogDeduplicator;

    beforeEach(() => {
        manager = new LogDeduplicator();
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe('Basic functionality', () => {
        it('should detect new logs as not recent', () => {
            const isRecent = manager.isRecentLog('trace-1', 'span-1');
            expect(isRecent).toBe(false);
        });

        it('should detect marked logs as recent', () => {
            manager.markLogSeen('trace-1', 'span-1');
            const isRecent = manager.isRecentLog('trace-1', 'span-1');
            expect(isRecent).toBe(true);
        });

        it('should handle different trace/span combinations independently', () => {
            manager.markLogSeen('trace-1', 'span-1');
            manager.markLogSeen('trace-1', 'span-2');
            
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(true);
            expect(manager.isRecentLog('trace-1', 'span-2')).toBe(true);
            expect(manager.isRecentLog('trace-1', 'span-3')).toBe(false);
            expect(manager.isRecentLog('trace-2', 'span-1')).toBe(false);
        });
    });

    describe('TTL functionality', () => {
        it('should expire entries after TTL', async () => {
            const shortTTL = 100;
            manager = new LogDeduplicator({ ttlMs: shortTTL });
            
            manager.markLogSeen('trace-1', 'span-1');
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, shortTTL + 10));
            
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(false);
        });

        it('should update TTL when checking recent logs', async () => {
            const shortTTL = 100;
            manager = new LogDeduplicator({ ttlMs: shortTTL });
            
            manager.markLogSeen('trace-1', 'span-1');
            
            await new Promise(resolve => setTimeout(resolve, shortTTL - 10));
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(false);
        });
    });

    describe('Capacity management', () => {
        it('should evict oldest entries when at capacity', () => {
            const maxEntries = 5;
            manager = new LogDeduplicator({ maxEntries });
            
            for (let i = 0; i < maxEntries; i++) {
                manager.markLogSeen(`trace-${i}`, `span-${i}`);
            }
            
            for (let i = 0; i < maxEntries; i++) {
                expect(manager.isRecentLog(`trace-${i}`, `span-${i}`)).toBe(true);
            }
            
            manager.markLogSeen('trace-new', 'span-new');
            
            expect(manager.isRecentLog('trace-new', 'span-new')).toBe(true);
            
            const stats = manager.getStats();
            expect(stats.totalEntries).toBeLessThanOrEqual(maxEntries);
        });

        it('should handle capacity of 1 correctly', () => {
            manager = new LogDeduplicator({ maxEntries: 1 });
            
            manager.markLogSeen('trace-1', 'span-1');
            expect(manager.isRecentLog('trace-1', 'span-1')).toBe(true);
            
            manager.markLogSeen('trace-2', 'span-2');
            expect(manager.isRecentLog('trace-2', 'span-2')).toBe(true);
        });
    });

    describe('Batch filtering', () => {
        const createMockLog = (traceId: string, spanId: string): LoggerObject => ({
            lvl: 3,
            msg: 'Test log',
            time: new Date().getTime(),
            trace: {
                traceId: traceId,
                spanId: spanId,
            },
            source: 'test-source',
            tags: [],
            ctx: { type: 'info' }
        });

        it('should filter out duplicate logs from batch', () => {
            const logs = [
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-1', 'span-2'),
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-2', 'span-1'),
            ];

            const filtered = manager.filterDuplicates(logs);
            
            expect(filtered).toHaveLength(3);
            expect(filtered.map((l: LoggerObject) => `${l.trace.traceId}:${l.trace.spanId}`)).toEqual([
                'trace-1:span-1',
                'trace-1:span-2', 
                'trace-2:span-1'
            ]);
        });

        it('should handle logs with missing trace/span IDs', () => {
            const logs = [
				createMockLog('trace-1', 'span-1'),
				{ ...createMockLog('', ''), trace: { traceId: '', spanId: '' } },
				{ ...createMockLog('trace-2', ''), trace: { traceId: 'trace-2', spanId: '' } },
				{ ...createMockLog('', 'span-3'), trace: { traceId: '', spanId: 'span-3' } },
				createMockLog('trace-3', 'span-3'),
			];

            const filtered = manager.filterDuplicates(logs);
            
            expect(filtered).toHaveLength(5);
			
			const stats = manager.getStats();
			expect(stats.totalEntries).toBe(2);
        });

        it('should filter duplicates across multiple batch calls', () => {
            const batch1 = [
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-1', 'span-2'),
            ];

            const batch2 = [
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-1', 'span-3'),
            ];

            const filtered1 = manager.filterDuplicates(batch1);
            const filtered2 = manager.filterDuplicates(batch2);

            expect(filtered1).toHaveLength(2);
            expect(filtered2).toHaveLength(1);
            expect(filtered2[0].trace.spanId).toBe('span-3');
        });

        it('should update statistics correctly', () => {
            const logs = [
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-1', 'span-1'),
                createMockLog('trace-2', 'span-2'),
            ];

            manager.filterDuplicates(logs);
            
            const stats = manager.getStats();
            expect(stats.duplicatesFiltered).toBe(1);
            expect(stats.totalEntries).toBe(2);
        });
    });

    describe('Statistics and monitoring', () => {
        it('should track statistics correctly', () => {
            manager.markLogSeen('trace-1', 'span-1');
            manager.isRecentLog('trace-1', 'span-1');
            manager.isRecentLog('trace-2', 'span-2');

            const stats = manager.getStats();
            
            expect(stats.totalEntries).toBe(1);
            expect(stats.recentChecks).toBe(2);
            expect(stats.memoryUsageBytes).toBeGreaterThan(0);
        });

        it('should provide detailed information', () => {
            manager.markLogSeen('trace-1', 'span-1');
            
            const info = manager.getDetailedInfo();
            
            expect(info.stats.totalEntries).toBe(1);
            expect(info.configuration.maxEntries).toBe(10000);
            expect(info.currentState.activeEntries).toBe(1);
            expect(info.currentState.oldestEntryAge).toBeGreaterThanOrEqual(0);
            expect(info.currentState.newestEntryAge).toBeGreaterThanOrEqual(0);
        });

        it('should report health status correctly', () => {
            expect(manager.isHealthy()).toBe(true);
            
            for (let i = 0; i < 100; i++) {
                manager.markLogSeen(`trace-${i}`, `span-${i}`);
            }
            
            expect(manager.isHealthy()).toBe(true);
        });
    });

    describe('Cleanup functionality', () => {
        it('should clean up expired entries', async () => {
            const shortTTL = 50;
            manager = new LogDeduplicator({ ttlMs: shortTTL });
            
            manager.markLogSeen('trace-1', 'span-1');
            manager.markLogSeen('trace-2', 'span-2');
            
            expect(manager.getStats().totalEntries).toBe(2);
            
            await new Promise(resolve => setTimeout(resolve, shortTTL + 10));
            
            manager.cleanup();
            
            expect(manager.getStats().totalEntries).toBe(0);
        });

        it('should perform automatic cleanup periodically', async () => {
            const shortTTL = 50;
            const shortCleanupInterval = 30;
            manager = new LogDeduplicator({ 
                ttlMs: shortTTL, 
                cleanupInterval: shortCleanupInterval 
            });
            
            manager.markLogSeen('trace-1', 'span-1');
            
            await new Promise(resolve => setTimeout(resolve, shortTTL + shortCleanupInterval + 10));
            
            manager.isRecentLog('trace-2', 'span-2');
            
            expect(manager.getStats().totalEntries).toBe(0);
        });

        it('should clear all entries', () => {
            manager.markLogSeen('trace-1', 'span-1');
            manager.markLogSeen('trace-2', 'span-2');
            
            expect(manager.getStats().totalEntries).toBe(2);
            
            manager.clear();
            
            const stats = manager.getStats();
            expect(stats.totalEntries).toBe(0);
            expect(stats.recentChecks).toBe(0);
            expect(stats.duplicatesFiltered).toBe(0);
            expect(stats.memoryUsageBytes).toBe(0);
        });

        it('should force cleanup when memory usage is high', () => {
            const smallCapacity = 10;
            manager = new LogDeduplicator({ maxEntries: smallCapacity });
            
            for (let i = 0; i < smallCapacity * 2; i++) {
                manager.markLogSeen(`trace-${i}`, `span-${i}`);
            }
            
            const statsBefore = manager.getStats();
            expect(statsBefore.totalEntries).toBeGreaterThan(smallCapacity * 0.7);
            
            manager.forceCleanup();
            
            const statsAfter = manager.getStats();
            expect(statsAfter.totalEntries).toBeLessThanOrEqual(smallCapacity * 0.7);
        });
    });

    describe('Edge cases', () => {
        it('should handle empty batch filtering', () => {
            const filtered = manager.filterDuplicates([]);
            expect(filtered).toEqual([]);
        });

        it('should treat empty/invalid trace or span IDs as non-dedupable', () => {
            expect(() => manager.isRecentLog('', '')).not.toThrow();
            expect(() => manager.markLogSeen('', '')).not.toThrow();
            
            expect(manager.isRecentLog('', '')).toBe(false);
            manager.markLogSeen('', '');
            expect(manager.isRecentLog('', '')).toBe(false);
            
            expect(manager.isRecentLog('trace-1', '')).toBe(false);
            expect(manager.isRecentLog('', 'span-1')).toBe(false);
            
            expect(manager.isRecentLog('valid-trace', 'valid-span')).toBe(false);
            manager.markLogSeen('valid-trace', 'valid-span');
            expect(manager.isRecentLog('valid-trace', 'valid-span')).toBe(true);
        });

        it('should handle very large trace/span IDs', () => {
            const longId = 'x'.repeat(1000);
            
            expect(() => manager.markLogSeen(longId, longId)).not.toThrow();
            expect(manager.isRecentLog(longId, longId)).toBe(true);
        });

        it('should handle rapid successive calls', () => {
            const traceId = 'trace-1';
            const spanId = 'span-1';
            
            for (let i = 0; i < 1000; i++) {
                manager.markLogSeen(`${traceId}-${i}`, `${spanId}-${i}`);
                expect(manager.isRecentLog(`${traceId}-${i}`, `${spanId}-${i}`)).toBe(true);
            }
        });
    });

    describe('Memory management', () => {
        it('should estimate memory usage reasonably', () => {
            const initialMemory = manager.getStats().memoryUsageBytes;
            expect(initialMemory).toBe(0);
            
            manager.markLogSeen('trace-1', 'span-1');
            const memoryAfter = manager.getStats().memoryUsageBytes;
            expect(memoryAfter).toBeGreaterThan(0);
            expect(memoryAfter).toBeLessThan(1000);
        });

        it('should update memory usage when entries are removed', () => {
            manager.markLogSeen('trace-1', 'span-1');
            manager.markLogSeen('trace-2', 'span-2');
            
            const memoryBefore = manager.getStats().memoryUsageBytes;
            expect(memoryBefore).toBeGreaterThan(0);
            
            manager.clear();
            
            const memoryAfter = manager.getStats().memoryUsageBytes;
            expect(memoryAfter).toBe(0);
        });
    });
});