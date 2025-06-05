import type { LoggerObject } from "../../shared/types/log";
import type { IDeduplicationManager, DeduplicationStats } from "./types";



export class DeduplicationManager implements IDeduplicationManager {
    private recentLogs = new Map<string, number>();
    private readonly maxEntries: number;
    private readonly ttlMs: number;
    private stats: DeduplicationStats;
    private lastCleanup: number;
    private readonly cleanupInterval: number;

    constructor(options: {
        maxEntries?: number;
        ttlMs?: number;
        cleanupInterval?: number;
    } = {}) {
        this.maxEntries = options.maxEntries || 10000;
        this.ttlMs = options.ttlMs || 5 * 60 * 1000;
        this.cleanupInterval = options.cleanupInterval || 60 * 1000;
        this.lastCleanup = Date.now();
        
        this.stats = {
            totalEntries: 0,
            recentChecks: 0,
            duplicatesFiltered: 0,
            memoryUsageBytes: 0
        };
    }

    isRecentLog(traceId: string, spanId: string): boolean {
        this.stats.recentChecks++;
        
        this.maybeCleanup();
        
        const key = this.createKey(traceId, spanId);
        const timestamp = this.recentLogs.get(key);
        
        if (!timestamp) {
            return false;
        }
        
        if (Date.now() - timestamp > this.ttlMs) {
            this.recentLogs.delete(key);
            this.updateMemoryUsage();
            return false;
        }
        
        return true;
    }

    markLogSeen(traceId: string, spanId: string): void {
        const key = this.createKey(traceId, spanId);
        const now = Date.now();
        
        if (this.recentLogs.size >= this.maxEntries) {
            this.evictOldest();
        }
        
        const wasNew = !this.recentLogs.has(key);
        this.recentLogs.set(key, now);
        
        if (wasNew) {
            this.stats.totalEntries++;
        }
        
        this.updateMemoryUsage();
    }

    filterDuplicates(logs: LoggerObject[]): LoggerObject[] {
        if (logs.length === 0) {
        return logs;
        }

        const filtered: LoggerObject[] = [];
        let duplicateCount = 0;

        for (const log of logs) {
        if (!log.trace.traceId || !log.trace.spanId) {
            filtered.push(log);
            continue;
        }

        if (this.isRecentLog(log.trace.traceId, log.trace.spanId)) {
            duplicateCount++;
            continue;
        }

        // Mark as seen and include
        this.markLogSeen(log.trace.traceId, log.trace.spanId);
        filtered.push(log);
        }

        this.stats.duplicatesFiltered += duplicateCount;
        return filtered;
    }

    getStats(): DeduplicationStats {
        this.updateMemoryUsage();
        return { ...this.stats };
    }

    cleanup(): void {
        const now = Date.now();
        const beforeSize = this.recentLogs.size;
        
        for (const [key, timestamp] of this.recentLogs.entries()) {
        if (now - timestamp > this.ttlMs) {
            this.recentLogs.delete(key);
        }
        }
        
        const removed = beforeSize - this.recentLogs.size;
        if (removed > 0) {
        this.stats.totalEntries = Math.max(0, this.stats.totalEntries - removed);
        this.updateMemoryUsage();
        }
        
        this.lastCleanup = now;
    }

    clear(): void {
        this.recentLogs.clear();
        this.stats = {
        totalEntries: 0,
        recentChecks: 0,
        duplicatesFiltered: 0,
        memoryUsageBytes: 0
        };
    }

    private createKey(traceId: string, spanId: string): string {
        return `${traceId}:${spanId}`;
    }

    private evictOldest(): void {
        const toRemove = Math.floor(this.maxEntries * 0.1);
        
        if (toRemove === 0) {
            return;
        }

        const entries = Array.from(this.recentLogs.entries())
        .sort((a, b) => a[1] - b[1]);
        
        for (let i = 0; i < toRemove && i < entries.length; i++) {
        this.recentLogs.delete(entries[i][0]);
        }
        
        this.stats.totalEntries = Math.max(0, this.stats.totalEntries - toRemove);
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup > this.cleanupInterval) {
        this.cleanup();
        }
    }

    private updateMemoryUsage(): void {
        this.stats.memoryUsageBytes = this.recentLogs.size * 50;
    }

    getDetailedInfo(): {
        stats: DeduplicationStats;
        configuration: {
        maxEntries: number;
        ttlMs: number;
        cleanupInterval: number;
        };
        currentState: {
        activeEntries: number;
        oldestEntryAge?: number;
        newestEntryAge?: number;
        };
    } {
        const now = Date.now();
        let oldestTimestamp: number | undefined;
        let newestTimestamp: number | undefined;

        for (const timestamp of this.recentLogs.values()) {
        if (oldestTimestamp === undefined || timestamp < oldestTimestamp) {
            oldestTimestamp = timestamp;
        }
        if (newestTimestamp === undefined || timestamp > newestTimestamp) {
            newestTimestamp = timestamp;
        }
        }

        return {
            stats: this.getStats(),
            configuration: {
                maxEntries: this.maxEntries,
                ttlMs: this.ttlMs,
                cleanupInterval: this.cleanupInterval
            },
            currentState: {
                activeEntries: this.recentLogs.size,
                oldestEntryAge: oldestTimestamp ? now - oldestTimestamp : undefined,
                newestEntryAge: newestTimestamp ? now - newestTimestamp : undefined
            }
        };
    }

    isHealthy(): boolean {
        const memoryUsageMB = this.stats.memoryUsageBytes / (1024 * 1024);
        if (memoryUsageMB > 100) {
            return false;
        }

        if (this.recentLogs.size > this.maxEntries * 1.1) {
            return false;
        }

        const timeSinceCleanup = Date.now() - this.lastCleanup;
        if (timeSinceCleanup > this.cleanupInterval * 2) {
            return false;
        }

        return true;
    }

    forceCleanup(): void {
        const now = Date.now();
        
        this.cleanup();
        
        if (this.recentLogs.size > this.maxEntries * 0.8) {
            const targetSize = Math.floor(this.maxEntries * 0.7);
            const toRemove = this.recentLogs.size - targetSize;
            
            if (toRemove > 0) {
                const entries = Array.from(this.recentLogs.entries())
                .sort((a, b) => a[1] - b[1]);
                
                for (let i = 0; i < toRemove; i++) {
                this.recentLogs.delete(entries[i][0]);
                }
                
                this.stats.totalEntries = Math.max(0, this.stats.totalEntries - toRemove);
            }
        }
        
        this.updateMemoryUsage();
    }
}