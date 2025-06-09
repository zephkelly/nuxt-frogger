import type { LoggerObject } from "../../shared/types/log";



export interface ILogDeduplicator {
    isRecentLog(traceId: string, spanId: string): boolean;
    markLogSeen(traceId: string, spanId: string): void;
    filterDuplicates(logs: LoggerObject[]): LoggerObject[];
    getStats(): DeduplicationStats;
    cleanup(): void;
    clear(): void;
}

export interface DeduplicationStats {
    totalEntries: number;
    recentChecks: number;
    duplicatesFiltered: number;
    memoryUsageBytes: number;
}