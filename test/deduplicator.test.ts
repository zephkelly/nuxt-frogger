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
            
            expect(filtered).toHaveLength(2);
			
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
            expect(info.configuration.maxEntries).toBe(1000);
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

    describe("Malformed Data", () => {
        const createMockLog = (traceId: any, spanId: any): LoggerObject => ({
            lvl: 3,
            msg: 'Test log',
            time: new Date().getTime(),
            trace: { traceId: traceId, spanId: spanId },
            source: 'test',
            tags: [],
            ctx: { type: 'info' }
        });

        describe('Non-string trace/span IDs (should be rejected as UUIDs must be strings)', () => {
            it('should handle null values', () => {
                expect(() => manager.isRecentLog(null as any, null as any)).not.toThrow();
                expect(() => manager.markLogSeen(null as any, null as any)).not.toThrow();
                
                expect(manager.isRecentLog(null as any, null as any)).toBe(false);
                manager.markLogSeen(null as any, null as any);
                expect(manager.isRecentLog(null as any, null as any)).toBe(false);
            });

            it('should handle undefined values', () => {
                expect(() => manager.isRecentLog(undefined as any, undefined as any)).not.toThrow();
                expect(() => manager.markLogSeen(undefined as any, undefined as any)).not.toThrow();
                
                expect(manager.isRecentLog(undefined as any, undefined as any)).toBe(false);
                manager.markLogSeen(undefined as any, undefined as any);
                expect(manager.isRecentLog(undefined as any, undefined as any)).toBe(false);
            });

            it('should reject number values', () => {
                expect(() => manager.isRecentLog(123 as any, 456 as any)).not.toThrow();
                expect(() => manager.markLogSeen(123 as any, 456 as any)).not.toThrow();
                
                expect(manager.isRecentLog(123 as any, 456 as any)).toBe(false);
                manager.markLogSeen(123 as any, 456 as any);
                expect(manager.isRecentLog(123 as any, 456 as any)).toBe(false);
            });

            it('should reject boolean values', () => {
                expect(() => manager.isRecentLog(true as any, false as any)).not.toThrow();
                expect(() => manager.markLogSeen(true as any, false as any)).not.toThrow();
                
                expect(manager.isRecentLog(true as any, false as any)).toBe(false);
                manager.markLogSeen(true as any, false as any);
                expect(manager.isRecentLog(true as any, false as any)).toBe(false);
            });

            it('should reject object values', () => {
                const obj1 = { id: 'trace' };
                const obj2 = { id: 'span' };
                
                expect(() => manager.isRecentLog(obj1 as any, obj2 as any)).not.toThrow();
                expect(() => manager.markLogSeen(obj1 as any, obj2 as any)).not.toThrow();
                
                expect(manager.isRecentLog(obj1 as any, obj2 as any)).toBe(false);
                manager.markLogSeen(obj1 as any, obj2 as any);
                expect(manager.isRecentLog(obj1 as any, obj2 as any)).toBe(false);
            });

            it('should reject array values', () => {
                const arr1 = ['trace', 'id'];
                const arr2 = ['span', 'id'];
                
                expect(() => manager.isRecentLog(arr1 as any, arr2 as any)).not.toThrow();
                expect(() => manager.markLogSeen(arr1 as any, arr2 as any)).not.toThrow();
                
                expect(manager.isRecentLog(arr1 as any, arr2 as any)).toBe(false);
                manager.markLogSeen(arr1 as any, arr2 as any);
                expect(manager.isRecentLog(arr1 as any, arr2 as any)).toBe(false);
            });

            it('should reject function values', () => {
                const fn1 = () => 'trace';
                const fn2 = () => 'span';
                
                expect(() => manager.isRecentLog(fn1 as any, fn2 as any)).not.toThrow();
                expect(() => manager.markLogSeen(fn1 as any, fn2 as any)).not.toThrow();
                
                expect(manager.isRecentLog(fn1 as any, fn2 as any)).toBe(false);
                manager.markLogSeen(fn1 as any, fn2 as any);
                expect(manager.isRecentLog(fn1 as any, fn2 as any)).toBe(false);
            });
        });

        describe('Special string values (should work as they are valid strings)', () => {
            it('should handle very long strings', () => {
                const longTrace = 'x'.repeat(10000);
                const longSpan = 'y'.repeat(10000);
                
                expect(() => manager.isRecentLog(longTrace, longSpan)).not.toThrow();
                
                expect(manager.isRecentLog(longTrace, longSpan)).toBe(false);
                
                expect(() => manager.markLogSeen(longTrace, longSpan)).not.toThrow();
                manager.markLogSeen(longTrace, longSpan);
                
                expect(manager.isRecentLog(longTrace, longSpan)).toBe(true);
            });

            it('should handle unicode characters', () => {
                const unicodeTrace = '🚀trace😀';
                const unicodeSpan = '🎯span🔥';
                
                expect(() => manager.isRecentLog(unicodeTrace, unicodeSpan)).not.toThrow();
                
                expect(manager.isRecentLog(unicodeTrace, unicodeSpan)).toBe(false);
                
                expect(() => manager.markLogSeen(unicodeTrace, unicodeSpan)).not.toThrow();
                manager.markLogSeen(unicodeTrace, unicodeSpan);
                
                expect(manager.isRecentLog(unicodeTrace, unicodeSpan)).toBe(true);
            });

            it('should handle special characters', () => {
                const specialTrace = '\\n\\t\\r\\0';
                const specialSpan = '<>&"\'';
                
                expect(() => manager.isRecentLog(specialTrace, specialSpan)).not.toThrow();
                
                expect(manager.isRecentLog(specialTrace, specialSpan)).toBe(false);
                
                expect(() => manager.markLogSeen(specialTrace, specialSpan)).not.toThrow();
                manager.markLogSeen(specialTrace, specialSpan);
                
                expect(manager.isRecentLog(specialTrace, specialSpan)).toBe(true);
            });

            it('should handle whitespace-only strings', () => {
                const whitespaceTrace = '   ';
                const whitespaceSpan = '\t\n\r';
                
                expect(() => manager.isRecentLog(whitespaceTrace, whitespaceSpan)).not.toThrow();
                
                expect(manager.isRecentLog(whitespaceTrace, whitespaceSpan)).toBe(false);
                
                expect(() => manager.markLogSeen(whitespaceTrace, whitespaceSpan)).not.toThrow();
                manager.markLogSeen(whitespaceTrace, whitespaceSpan);
                
                expect(manager.isRecentLog(whitespaceTrace, whitespaceSpan)).toBe(true);
            });

            it('should handle strings with only special JSON characters', () => {
                const jsonTrace = '{}[]":,';
                const jsonSpan = '\\/"';
                
                expect(() => manager.isRecentLog(jsonTrace, jsonSpan)).not.toThrow();
                
                expect(manager.isRecentLog(jsonTrace, jsonSpan)).toBe(false);
                
                expect(() => manager.markLogSeen(jsonTrace, jsonSpan)).not.toThrow();
                manager.markLogSeen(jsonTrace, jsonSpan);
                
                expect(manager.isRecentLog(jsonTrace, jsonSpan)).toBe(true);
            });
        });

        describe('Malformed log objects in filterDuplicates', () => {

            it('should handle logs with no trace property', () => {
                const logs = [
                    { message: 'test', timestamp: new Date().toISOString() },
                    createMockLog('valid-trace', 'valid-span'),
                    { trace: null }
                ] as any[];

                const filtered = manager.filterDuplicates(logs);
                expect(filtered).toHaveLength(1);
                
                const stats = manager.getStats();
                expect(stats.totalEntries).toBe(1);
            });

            it('should handle logs with malformed trace objects', () => {
                const logs = [
                    { trace: {} },
                    { trace: { traceId: 'only-trace' } },
                    { trace: { spanId: 'only-span' } },
                    { trace: { traceId: null, spanId: null } },
                    { trace: { traceId: undefined, spanId: undefined } },
                    { trace: 'not-an-object' },
                    createMockLog('valid-trace', 'valid-span')
                ] as any[];

                const filtered = manager.filterDuplicates(logs);
                expect(filtered).toHaveLength(1);
                
                const stats = manager.getStats();
                expect(stats.totalEntries).toBe(1);
            });

            it('should handle null and undefined logs', () => {
                const logs = [
                    null,
                    undefined,
                    createMockLog('valid-trace', 'valid-span'),
                    null
                ] as any[];

                const filtered = manager.filterDuplicates(logs);
                expect(filtered).toHaveLength(1);
                
                const stats = manager.getStats();
                expect(stats.totalEntries).toBe(1);
            });
        });

        describe('Extreme data scenarios', () => {
            it('should handle very large arrays', () => {
                const largeBatch = Array.from({ length: 1000 }, (_, i) => 
                    createMockLog(`trace-${i}`, `span-${i}`)
                );

                const filtered = manager.filterDuplicates(largeBatch);
                expect(filtered).toHaveLength(1000);
                
                const stats = manager.getStats();
                expect(stats.totalEntries).toBe(1000);
            });

            it('should handle array with all duplicate trace/span combinations', () => {
                const duplicateBatch = Array.from({ length: 1000 }, () => 
                    createMockLog('same-trace', 'same-span')
                );

                const filtered = manager.filterDuplicates(duplicateBatch);
                expect(filtered).toHaveLength(1);
                
                const stats = manager.getStats();
                expect(stats.duplicatesFiltered).toBe(999);
                expect(stats.totalEntries).toBe(1);
            });

            it('should handle array with mixed valid and invalid data', () => {
                const mixedBatch = [
                    createMockLog('valid-1', 'valid-1'),
                    null,
                    createMockLog('', ''),
                    undefined,
                    createMockLog('valid-2', 'valid-2'),
                    { trace: {} },
                    createMockLog('valid-1', 'valid-1'),
                    'string',
                    123,
                    createMockLog(null as any, null as any),
                    createMockLog('valid-3', 'valid-3')
                ] as any[];

                const filtered = manager.filterDuplicates(mixedBatch);
                expect(filtered.length).toBeGreaterThan(0);
                
                const stats = manager.getStats();
                expect(stats.duplicatesFiltered).toBe(1); // Only valid-1:valid-1 is duplicated
            });

            it('should handle rapid successive operations', () => {
                expect(() => {
                    for (let i = 0; i < 10000; i++) {
                        manager.markLogSeen(`rapid-trace-${i % 100}`, `rapid-span-${i % 50}`);
                        manager.isRecentLog(`rapid-trace-${i % 100}`, `rapid-span-${i % 50}`);
                    }
                }).not.toThrow();
            });
        });

        describe('Memory and performance edge cases', () => {
            it('should handle maximum entries without crashing', () => {
                const smallManager = new LogDeduplicator({ maxEntries: 10 });
                
                for (let i = 0; i < 100; i++) {
                    smallManager.markLogSeen(`trace-${i}`, `span-${i}`);
                }
                
                const stats = smallManager.getStats();
                expect(stats.totalEntries).toBeLessThanOrEqual(10);
                expect(smallManager.isHealthy()).toBe(true);
            });

            it('should handle entries with identical string representations but different types', () => {
                manager.markLogSeen('123', '456');
                manager.markLogSeen(123 as any, 456 as any);
                
                expect(manager.isRecentLog('123', '456')).toBe(true);
                expect(manager.isRecentLog(123 as any, 456 as any)).toBe(false);
                
                const logs = [
                    createMockLog('123', '456'),
                    createMockLog(123 as any, 456 as any)
                ];
                
                const filtered = manager.filterDuplicates(logs);
                expect(filtered).toHaveLength(0);
            });

            it('should handle keys that could cause hash collisions', () => {
                const problematicKeys = [
                    ['a:b', 'c'],
                    ['a', 'b:c'],
                    [':', ':'],
                    ['', ':'],
                    [':', '']
                ];
                
                problematicKeys.forEach(([traceId, spanId]) => {
                    expect(() => manager.markLogSeen(traceId, spanId)).not.toThrow();
                    // Empty strings should be rejected
                    const shouldBeStored = traceId.length > 0 && spanId.length > 0;
                    expect(manager.isRecentLog(traceId, spanId)).toBe(shouldBeStored);
                });
            });

            it('should handle operations during cleanup', async () => {
                const cleanupManager = new LogDeduplicator({ 
                    ttlMs: 50, 
                    cleanupInterval: 25 
                });
                
                cleanupManager.markLogSeen('before-cleanup', 'before-cleanup');
                
                await new Promise(resolve => setTimeout(resolve, 60));
                
                cleanupManager.markLogSeen('during-cleanup', 'during-cleanup');
                expect(cleanupManager.isRecentLog('during-cleanup', 'during-cleanup')).toBe(true);
                expect(cleanupManager.isRecentLog('before-cleanup', 'before-cleanup')).toBe(false);
            });

            it('should maintain statistics accuracy under stress', () => {
                const logs = [];
                for (let i = 0; i < 100; i++) {
                    logs.push(createMockLog(`trace-${i % 10}`, `span-${i % 5}`));
                }
                
                const filtered = manager.filterDuplicates(logs);
                const stats = manager.getStats();
                
                expect(filtered.length + stats.duplicatesFiltered).toBe(100);
                expect(stats.recentChecks).toBeGreaterThan(0);
                expect(stats.memoryUsageBytes).toBeGreaterThan(0);
            });
        });

        describe('Boundary conditions', () => {
            it('should handle negative TTL', () => {
                const negativeTTLManager = new LogDeduplicator({ ttlMs: -1000 });
                
                negativeTTLManager.markLogSeen('trace-1', 'span-1');
                expect(negativeTTLManager.isRecentLog('trace-1', 'span-1')).toBe(false);
            });

            it('should handle extremely small cleanup interval', () => {
                expect(() => new LogDeduplicator({ cleanupInterval: 1 })).not.toThrow();
                const fastCleanupManager = new LogDeduplicator({ cleanupInterval: 1 });
                
                fastCleanupManager.markLogSeen('trace-1', 'span-1');
                expect(fastCleanupManager.isRecentLog('trace-1', 'span-1')).toBe(true);
            });

            it('should handle extremely large values', () => {
                expect(() => new LogDeduplicator({ 
                    maxEntries: Number.MAX_SAFE_INTEGER,
                    ttlMs: Number.MAX_SAFE_INTEGER,
                    cleanupInterval: Number.MAX_SAFE_INTEGER
                })).not.toThrow();
            });

            it('should handle NaN and Infinity values in configuration', () => {
                expect(() => new LogDeduplicator({ 
                    maxEntries: NaN,
                    ttlMs: Infinity,
                    cleanupInterval: -Infinity
                })).not.toThrow();
            });
        });
    })
});