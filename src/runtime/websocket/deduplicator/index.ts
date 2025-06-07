import { log } from "console";
import type { LoggerObject } from "../../shared/types/log";
import type { ILogDeduplicator, DeduplicationStats } from "./types";



export class LogDeduplicator implements ILogDeduplicator {
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
        this.maxEntries = this.sanitiseNumber(options.maxEntries) || 1000;
        this.ttlMs = this.sanitiseNumber(options.ttlMs) || 5 * 60 * 1000;
        this.cleanupInterval = this.sanitiseNumber(options.cleanupInterval) || 1 * 60 * 1000;
        this.lastCleanup = Date.now();
        
        this.stats = {
            totalEntries: 0,
            recentChecks: 0,
            duplicatesFiltered: 0,
            memoryUsageBytes: 0
        };
    }

    private sanitiseNumber(value: any): number {
        if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
            return Math.floor(value);
        }
        if (typeof value === 'string' && !isNaN(Number(value)) && isFinite(Number(value))) {
            return Math.floor(Number(value));
        }
        return 0;
    }

    private isValidStringId(id: any): boolean {
        return typeof id === 'string' && id.length > 0;
    }

    
    isRecentLog(traceId: string, spanId: string): boolean {
        this.stats.recentChecks++;

        if (!this.isValidStringId(traceId) || !this.isValidStringId(spanId)) {
            return false;
        }

        if (this.maxEntries <= 0) {
            return false;
        }
        
        this.maybeCleanup();
        
        const key = this.createKey(traceId, spanId);
        const timestamp = this.recentLogs.get(key);
        
        if (!timestamp) {
            return false;
        }
        
        if (this.ttlMs <= 0 || Date.now() - timestamp > this.ttlMs) {
            this.recentLogs.delete(key);
            this.updateMemoryUsage();
            return false;
        }
        
        return true;
    }

    markLogSeen(traceId: string, spanId: string): void {
        if (!this.isValidStringId(traceId) || !this.isValidStringId(spanId)) {
            return;
        }

        if (this.maxEntries <= 0) {
            return;
        }

        const key = this.createKey(traceId, spanId);
        const now = Date.now();
        
        if (this.recentLogs.size >= this.maxEntries) {
            this.removeOldest();
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
            if (!log || typeof log !== 'object') {
                continue;
            }

            let traceId: any = null;
            let spanId: any = null;

            try {
                if (log.trace && typeof log.trace === 'object') {
                    traceId = log.trace.traceId;
                    spanId = log.trace.spanId;
                }
            }
            catch (error) {
                continue;
            }
            
            if (!this.isValidStringId(traceId) || !this.isValidStringId(spanId)) {
                continue;
            }

            if (this.isRecentLog(traceId, spanId)) {
                duplicateCount++;
                continue;
            }

            this.markLogSeen(traceId, spanId);
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
            if (this.ttlMs <= 0 || now - timestamp > this.ttlMs) {
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

    private removeOldest(): void {
        let toRemove = Math.floor(this.maxEntries * 0.1);
        
        if (toRemove === 0 && this.recentLogs.size >= this.maxEntries) {
            toRemove = 1;
        }
        
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