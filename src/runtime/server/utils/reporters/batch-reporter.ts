import type { BatchReporterOptions } from '../../types/batch-reporter';
import type { LoggerObject } from '~/src/runtime/shared/types';



/**
 * Reporter that batches logs before sending them to a destination
 */
export class BatchReporter {
    private logs: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private options: Required<BatchReporterOptions>;
    private flushing: boolean = false;
    private retries: Map<string, number> = new Map();
    private flushPromise: Promise<void> = Promise.resolve();
    
    constructor(options: BatchReporterOptions) {
        this.options = {
            maxSize: options.maxSize ?? 100,
            maxAge: options.maxAge ?? 5000, // 5 seconds
            onFlush: options.onFlush,
            includeTraceContext: options.includeTraceContext ?? true,
            additionalFields: options.additionalFields ?? {},
            levels: options.levels ?? [],
            retryOnFailure: options.retryOnFailure ?? true,
            maxRetries: options.maxRetries ?? 3,
            retryDelay: options.retryDelay ?? 1000
        };
    }
    
    /**
     * Handle an incoming log and add it to the batch
     */
    log(logObj: LoggerObject): void {
        // Apply level filtering if configured
        if (this.options.levels.length > 0) {
            // In consola, higher level means more verbose
            if (!this.options.levels.includes(logObj.level)) {
                return;
            }
        }
        
        // Deep clone the log object to avoid mutations
        const logCopy = structuredClone(logObj);
        
        // Add additional fields
        Object.assign(logCopy, this.options.additionalFields);
        
        // Store the log
        this.logs.push(logCopy);
        
        // If we've reached max size, schedule an immediate flush
        if (this.logs.length >= this.options.maxSize) {
            this.scheduleFlush(0);
            return;
        }
        
        // Set a timer to flush if one isn't already set
        this.scheduleFlush();
    }
    
    /**
     * Schedule a flush operation
     */
    private scheduleFlush(delay: number = this.options.maxAge): void {
        // If already flushing or no logs to flush, do nothing
        if (this.flushing || (this.timer !== null && delay === this.options.maxAge)) {
            return;
        }
        
        // If timer exists, clear it
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        // Set new timer
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flushPromise = this.flushPromise.then(() => this.flush());
        }, delay);
    }
    
    /**
     * Manually flush logs
     */
    async flush(): Promise<void> {
        // Prevent concurrent flushes
        if (this.flushing) {
            return;
        }
        
        // Clear any pending timer
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        // If no logs, nothing to flush
        if (this.logs.length === 0) {
            return;
        }
        
        // Mark as flushing to prevent concurrent operations
        this.flushing = true;
        
        try {
            // Get current logs and reset the array
            const logsToFlush = [...this.logs];
            this.logs = [];
            
            // Generate a unique batch ID for tracking retries
            const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            try {
                // Call the onFlush handler
                await this.options.onFlush(logsToFlush);
                // Clear retry count on success
                this.retries.delete(batchId);
            } catch (error) {
                console.error(`Failed to flush logs (batch ${batchId}):`, error);
                
                // If configured to retry, handle the failure
                if (this.options.retryOnFailure) {
                    this.handleFlushFailure(batchId, logsToFlush);
                }
                else {
                    // Otherwise, logs are lost
                    console.error(`Dropped ${logsToFlush.length} logs due to flush failure`);
                }
            }
        }
        finally {
            // Mark as no longer flushing
            this.flushing = false;
            
            // If new logs arrived during flush, schedule another flush
            if (this.logs.length > 0) {
                this.scheduleFlush(1000); // Small delay to avoid hammering the destination
            }
        }
    }
    
    /**
     * Handle a failed flush attempt with retry logic
     */
    private handleFlushFailure(batchId: string, logs: LoggerObject[]): void {
        // Get current retry count for this batch
        const retryCount = this.retries.get(batchId) || 0;
        
        // Check if we've hit the maximum retries
        if (retryCount >= this.options.maxRetries) {
        console.error(`Maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${logs.length} logs.`);
        // Remove this batch from retry tracking
        this.retries.delete(batchId);
        return;
        }
        
        // Increment retry count
        this.retries.set(batchId, retryCount + 1);
        
        // Calculate backoff delay using exponential backoff
        const backoffDelay = this.options.retryDelay * Math.pow(2, retryCount);
        
        // Log retry info
        console.warn(`Scheduling retry #${retryCount + 1} for batch ${batchId} in ${backoffDelay}ms`);
        
        // Schedule retry
        setTimeout(async () => {
        // Check if this batch is still being tracked (could have been removed)
        if (!this.retries.has(batchId)) {
            return;
        }
        
        try {
            // Attempt to flush again
            await this.options.onFlush(logs);
            console.log(`Retry #${retryCount + 1} for batch ${batchId} succeeded`);
            // Clear retry count on success
            this.retries.delete(batchId);
        } catch (error) {
            console.error(`Retry #${retryCount + 1} for batch ${batchId} failed:`, error);
            // Handle failure again (will re-check retry count)
            this.handleFlushFailure(batchId, logs);
        }
        }, backoffDelay);
    }
  
    /**
     * Force immediate flush and wait for completion
     */
    async forceFlush(): Promise<void> {
        // Wait for any current flush to complete
        await this.flushPromise;
        // Then do another flush
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

/**
 * Create a batch reporter for a database
 * This is a placeholder implementation - you'd need to adapt this for your specific database
 */
export function createDatabaseBatchReporter(
    dbConfig: any,
    options: Omit<BatchReporterOptions, 'onFlush'> = {}
): BatchReporter {
    // This is highly dependent on your database solution
    // Example implementation for a hypothetical database client
    return new BatchReporter({
        ...options,
        async onFlush(logs) {
            try {
                
            }
            catch (error) {
                
            }
        }
    });
}

async function connectToDatabase(config: any): Promise<any> {
    throw new Error('Not implemented: replace with your database connection logic');
}