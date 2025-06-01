import { defu } from 'defu';
import { useRuntimeConfig } from '#imports';

import { BaseReporter } from './base-reporter';
import type { BatchReporterOptions } from '../../types/batch-reporter';
import type { LoggerObject } from '~/src/runtime/shared/types/log';



/**
 * Reporter that batches logs before sending them to a destination
 */
export class BatchReporter extends BaseReporter<Required<BatchReporterOptions>> {
    public readonly name = 'FroggerBatchReporter';

    private logs: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    protected options: Required<BatchReporterOptions>;
    private lastFlushTime: number = 0;
    private flushing: boolean = false;
    private retries: Map<string, number> = new Map();
    private flushPromise: Promise<void> = Promise.resolve();
    
    constructor(options: BatchReporterOptions) {
        super();
        const config = useRuntimeConfig()

        
        this.options = defu(options, config.public.frogger.batch) as Required<BatchReporterOptions>;
    }
    
    /**
     * Handle an incoming log and add it to the batch
     */
    log(logObj: LoggerObject): void {
        const processedLogs = this.processLogs([logObj]);
        if (processedLogs.length === 0) {
            return; // Log was filtered out
        }
        
        this.addLogsToBuffer(processedLogs);
    }

    /**
     * Handle a batch of incoming logs and add them to the batch
     */
    override logBatch(logs: LoggerObject[]): void {
        if (logs.length === 0) {
            return;
        }

        const processedLogs = this.processLogs(logs);
        if (processedLogs.length === 0) {
            console.debug('All logs in batch were filtered out');
            return;
        }
        
        this.addLogsToBuffer(processedLogs);
    }

    /**
     * Process logs by filtering and adding additional fields
     */
    private processLogs(logs: LoggerObject[]): LoggerObject[] {
        const processedLogs: LoggerObject[] = [];
        
        for (const log of logs) {
            if (this.options.levels && this.options.levels.length > 0) {

                if (!this.options.levels.includes(log.level)) {
                    continue;
                }
            }

            processedLogs.push(log);
        }

        return processedLogs;
    }

    /**
     * Add processed logs to the buffer and handle flushing
     */
    private addLogsToBuffer(logs: LoggerObject[]): void {
        for (const log of logs) {
            this.insertSorted(log);
        }
        
        if (this.logs.length >= this.options.maxSize) {
            this.handleMaxSizeReached();
            return;
        }
        
        this.scheduleFlush();
    }

    /**
     * Handle the case when maxSize is reached
     */
    private handleMaxSizeReached(): void {
        const now = Date.now();
        const cutoffTime = now - this.options.sortingWindowMs;
        const logsToFlush = this.logs.filter(log => log.timestamp <= cutoffTime);
        
        if (logsToFlush.length > 0) {
            console.debug('Flushing immediately. Buffer full and old logs available');
            this.scheduleFlush(0);
        }
        else {
            const oldestLog = this.logs[0];
            const waitTime = Math.max(0, (oldestLog.timestamp + this.options.sortingWindowMs) - now);
            console.debug(`All logs too new, waiting ${waitTime}ms for sorting window`);
            this.scheduleFlush(waitTime);
        }
    }

    /**
     * Insert log in sorted position (by timestamp)
     */
    private insertSorted(log: LoggerObject): void {
        let left = 0;
        let right = this.logs.length;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.logs[mid].timestamp <= log.timestamp) {
                left = mid + 1;
            }
            else {
                right = mid;
            }
        }
        
        this.logs.splice(left, 0, log);
    }
    
    

    // Flush handling ------------------------------------------------------
    
    /**
     * Handle a failed flush attempt with retry logic
     */
    private handleFlushFailure(batchId: string, logs: LoggerObject[]): void {
        const retryCount = this.retries.get(batchId) || 0;
        
        if (retryCount >= this.options.maxRetries) {
            console.error(`Maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${logs.length} logs.`);
            this.retries.delete(batchId);
            return;
        }
        
        this.retries.set(batchId, retryCount + 1);
        
        const backoffDelay = this.options.retryDelay * Math.pow(2, retryCount);
        
        console.warn(`Scheduling retry #${retryCount + 1} for batch ${batchId} in ${backoffDelay}ms`);
        
        setTimeout(async () => {
        if (!this.retries.has(batchId)) {
            return;
        }
        
        try {
            await this.options.onFlush(logs);
            console.log(`Retry #${retryCount + 1} for batch ${batchId} succeeded`);
            this.retries.delete(batchId);
        }
        catch (error) {
            console.error(`Retry #${retryCount + 1} for batch ${batchId} failed:`, error);
            this.handleFlushFailure(batchId, logs);
        }
        }, backoffDelay);
    }

    /**
     * Schedule a flush operation
     */
    private scheduleFlush(delay: number = this.options.maxAge): void {
        if (this.flushing || (this.timer !== null && delay === this.options.maxAge)) {
            return;
        }
        
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flushPromise = this.flushPromise.then(() => this.flush());
        }, delay);
    }
    
    /**
     * Manually flush logs
     */
    override async flush(): Promise<void> {
        if (this.flushing) {
            return;
        }
        
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        if (this.logs.length === 0) {
            return;
        }
        
        this.flushing = true;
        
        try {
            const cutoffTime = Date.now() - this.options.sortingWindowMs;
            const logsToFlush = this.logs.filter(log => log.timestamp <= cutoffTime);
            
            if (logsToFlush.length === 0) {
                if (this.logs.length > 0) {
                    this.scheduleFlush(this.options.sortingWindowMs);
                }
                return;
            }
            
            this.logs = this.logs.filter(log => log.timestamp > cutoffTime);
            
            const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            try {
                await this.options.onFlush(logsToFlush);
                this.retries.delete(batchId);
                this.lastFlushTime = Date.now();
            }
            catch (error) {
                console.error(`Failed to flush logs (batch ${batchId}):`, error);
                
                if (this.options.retryOnFailure) {
                    this.handleFlushFailure(batchId, logsToFlush);
                }
                else {
                    console.error(`Dropped ${logsToFlush.length} logs due to flush failure`);
                }
            }
        }
        finally {
            this.flushing = false;
            
            if (this.logs.length > 0) {
                this.scheduleFlush(Math.min(this.options.maxAge, this.options.sortingWindowMs));
            }
        }
    }
  
    /**
     * Force immediate flush and wait for completion
     */
    override async forceFlush(): Promise<void> {
        await this.flushPromise;
        return this.flush();
    }
}