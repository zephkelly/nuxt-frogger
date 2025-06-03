import type { LoggerObject } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';

import { useRuntimeConfig } from '#app';


interface RetryState {
    count: number;
    nextRetryAt: number;
    backoffMultiplier: number;
}

/**
 * Centralized log queue service
 */
export class LogQueueService {
    private queue: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    private batchingEnabled: boolean = true;

    private endpoint: string;
    private maxBatchSize: number | undefined;
    private maxBatchAge: number | undefined;
    private maxQueueSize: number | undefined;
    
    private appInfo: { name: string; version: string } = { 
        name: 'unknown', 
        version: 'unknown' 
    };

    private retryState: RetryState = {
        count: 0,
        nextRetryAt: 0,
        backoffMultiplier: 1
    };
    private readonly maxRetries = 5;
    private readonly baseBackoffMs = 1000;
    private readonly maxBackoffMs = 300000;
    private readonly rateLimitBackoffMs = 60000;

    constructor() {
        const config = useRuntimeConfig();
        
        this.endpoint = config.public.frogger.endpoint;

        //@ts-expect-error
        this.batchingEnabled = config.public?.frogger?.batch !== false;

        if (!this.batchingEnabled) return;

        this.maxBatchSize = config.public.frogger.batch?.maxSize;
        this.maxBatchAge = config.public.frogger.batch?.maxAge;
        this.maxQueueSize = config.public.frogger.batch?.maxSize || 1000;
    }

    /**
     * Set application information for the log batch
     */
    setAppInfo(name: string, version: string): void {
        this.appInfo = { name, version };
    }

    /**
     * Add a log to the centralized queue
     */
    enqueueLog(log: LoggerObject): void {
        if (!this.batchingEnabled) {
            this.sendLogImmediately(log);
            return;
        }

        this.queue.push(log);
        
        // Trim the queue if it exceeds the maximum size
        if (this.maxQueueSize && this.queue.length > this.maxQueueSize) {
            this.queue = this.queue.slice(-this.maxQueueSize);
            console.warn(`Log queue exceeded maximum size of ${this.maxQueueSize}. Old logs have been discarded.`);
        }
        
        this.scheduleSend();
    }

    private isRateLimited(): boolean {
        return Date.now() < this.retryState.nextRetryAt;
    }

    private resetRetryState(): void {
        this.retryState = {
            count: 0,
            nextRetryAt: 0,
            backoffMultiplier: 1
        };
    }

    /**
     * Handle rate limit response and set appropriate backoff
     */
    private handleRateLimit(retryAfter?: number): void {
        const backoffMs = retryAfter 
            ? retryAfter * 1000
            : Math.min(
                this.rateLimitBackoffMs * this.retryState.backoffMultiplier,
                this.maxBackoffMs
            );

        this.retryState.nextRetryAt = Date.now() + backoffMs;
        this.retryState.count++;
        this.retryState.backoffMultiplier *= 2;

        console.warn(
            `Rate limited! Backing off for ${Math.round(backoffMs / 1000)}s. ` +
            `Retry attempt ${this.retryState.count}/${this.maxRetries}`
        );

        setTimeout(() => {
            if (this.queue.length > 0) {
                this.scheduleSend();
            }
        }, backoffMs);
    }

    /**
     * Handle general error with exponential backoff
     */
    private handleGeneralError(error: any): void {
        this.retryState.count++;
        
        if (this.retryState.count >= this.maxRetries) {
            console.error(`Max retries (${this.maxRetries}) reached. Dropping ${this.queue.length} logs.`);
            this.queue = [];
            this.resetRetryState();
            return;
        }

        const backoffMs = Math.min(
            this.baseBackoffMs * Math.pow(2, this.retryState.count - 1),
            this.maxBackoffMs
        );

        this.retryState.nextRetryAt = Date.now() + backoffMs;

        console.warn(
            `Send failed (attempt ${this.retryState.count}/${this.maxRetries}). ` +
            `Retrying in ${Math.round(backoffMs / 1000)}s. Error:`, 
            error.message || error
        );

        setTimeout(() => {
            if (this.queue.length > 0) {
                this.scheduleSend();
            }
        }, backoffMs);
    }

    /**
     * Schedule sending logs to the server
     */
    private scheduleSend(): void {
        if (!this.batchingEnabled) return;

        if (this.isRateLimited()) {
            return;
        }

        if (this.maxBatchSize && this.queue.length >= this.maxBatchSize) {
            this.sendLogs();
            return;
        }
        
        if (this.timer !== null) {
            return;
        }
        
        this.timer = setTimeout(() => {
            this.timer = null;
            this.sendLogs();
        }, this.maxBatchAge);
    }

    /**
     * Send logs to the server endpoint
     */
    private async sendLogs(): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0 || this.sending) {
            return;
        }

        if (this.isRateLimited()) {
            return;
        }
        
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        this.sending = true;
        
        const logs = [...this.queue];
        this.queue = [];
        
        try {
            if (!this.endpoint) {
                console.warn('No endpoint specified for sending logs');
                return;
            }
            
            const batch: LoggerObjectBatch = {
                logs,
                app: this.appInfo,
                meta: {
                    time: Date.now(),
                    processChain: [this.appInfo.name]
                }
            };
            
            await $fetch.raw(this.endpoint, {
                method: 'POST',
                body: batch,
            });

            this.resetRetryState();
        }
        catch (error: any) {
            console.error('Failed to send logs:', error);
            
            if (error.response?.status === 429) {
                const retryAfter = error.response.headers?.['x-rate-limit-retry-after'] || 
                                 error.response.headers?.['retry-after'];
                
                if (this.maxQueueSize) {
                    this.queue = [...logs, ...this.queue].slice(0, this.maxQueueSize);
                }
                
                this.handleRateLimit(retryAfter ? parseInt(retryAfter) : undefined);
                return;
            }

            if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
                console.error(`Client error (${error.response.status}). Dropping logs to prevent retry loop.`);
                this.resetRetryState();
                return;
            }

            this.queue = [...logs, ...this.queue];
            if (this.maxQueueSize && this.queue.length > this.maxQueueSize) {
                const dropped = this.queue.length - this.maxQueueSize;
                this.queue = this.queue.slice(0, this.maxQueueSize);
                console.warn(`Dropped ${dropped} logs due to queue overflow during retry`);
            }
            
            this.handleGeneralError(error);
        }
        finally {
            this.sending = false;
            
            if (this.queue.length > 0 && !this.isRateLimited()) {
                this.scheduleSend();
            }
        }
    }

    /**
     * Send a single log immediately (used when batching is disabled)
     */
    private async sendLogImmediately(log: LoggerObject): Promise<void> {
        if (!this.endpoint) return;

        if (this.isRateLimited()) {
            console.debug('Dropping immediate log due to rate limiting');
            return;
        }

        const batch: LoggerObjectBatch = {
            logs: [log],
            app: this.appInfo
        };

        try {
            await $fetch.raw(this.endpoint, {
                method: 'POST',
                body: batch,
            });

            this.resetRetryState();
        }
        catch (error: any) {
            console.error('Failed to send log immediately:', error);
            
            if (error.response?.status === 429) {
                const retryAfter = error.response.headers?.['x-rate-limit-retry-after'] || 
                                 error.response.headers?.['retry-after'];
                this.handleRateLimit(retryAfter ? parseInt(retryAfter) : undefined);
            }
        }
    }

    /**
     * Force flush any pending logs (only applicable when batching is enabled)
     */
    async flush(): Promise<void> {
        if (!this.batchingEnabled) {
            return;
        }

        if (this.queue.length > 0) {
            await this.sendLogs();
        }
    }
}