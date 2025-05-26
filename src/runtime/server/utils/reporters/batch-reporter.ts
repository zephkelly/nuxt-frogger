import type { BatchReporterOptions } from '../../types/batch-reporter';
import type { LoggerObject } from '~/src/runtime/shared/types/log';



/**
 * Reporter that batches logs before sending them to a destination
 */
export class BatchReporter {
    private logs: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private options: Required<BatchReporterOptions>;
    private lastFlushTime: number = 0;
    private flushing: boolean = false;
    private retries: Map<string, number> = new Map();
    private flushPromise: Promise<void> = Promise.resolve();
    
    constructor(options: BatchReporterOptions) {
        this.options = {
            maxSize: options.maxSize ?? 100,
            maxAge: options.maxAge ?? 5000,
            onFlush: options.onFlush,
            includeTraceContext: options.includeTraceContext ?? true,
            additionalFields: options.additionalFields ?? {},
            levels: options.levels ?? [],
            retryOnFailure: options.retryOnFailure ?? true,
            maxRetries: options.maxRetries ?? 3,
            retryDelay: options.retryDelay ?? 1000,

            sortingWindowMs: options.sortingWindowMs ?? 2000
        };
    }
    
    /**
     * Handle an incoming log and add it to the batch
     */
    log(logObj: LoggerObject): void {
        if (this.options.levels.length > 0) {
            if (!this.options.levels.includes(logObj.level)) {
                return;
            }
        }
        
        const logCopy = structuredClone(logObj);
        Object.assign(logCopy, this.options.additionalFields);
        
        this.insertSorted(logCopy);
        
        if (this.logs.length >= this.options.maxSize) {
            const cutoffTime = Date.now() - this.options.sortingWindowMs;
            const logsToFlush = this.logs.filter(log => log.timestamp <= cutoffTime);
            
            if (logsToFlush.length > 0) {
                this.scheduleFlush(0);
            }
            else {
                this.scheduleFlush(this.options.sortingWindowMs);
            }
            return;
        }
        
        this.scheduleFlush();
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
    async flush(): Promise<void> {
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
     * Force immediate flush and wait for completion
     */
    async forceFlush(): Promise<void> {
        await this.flushPromise;
        return this.flush();
    }
}

/**
 * Create a batch reporter for sending logs to a REST API endpoint
 */
export function createHttpBatchReporter(
    url: string, 
    options: Omit<BatchReporterOptions, 'onFlush'> & {
        headers?: Record<string, string>;
        method?: string;
        timeout?: number;
    } = {}
): BatchReporter {
    return new BatchReporter({
        ...options,
        async onFlush(logs) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, options.timeout || 10000);
            
            try {
                const response = await $fetch(url, {
                    method: 'POST',
                    body: { logs },
                    signal: controller.signal
                });
            }
            catch (error: any) {
                if (error.name === 'AbortError') {
                    console.error('Request timed out');
                } else {
                    console.error('Failed to send logs:', error);
                }
            }
            finally {
                clearTimeout(timeoutId);
            }
        }
    });
}