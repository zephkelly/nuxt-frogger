import type { LoggerObject } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';

import { useRuntimeConfig } from '#app';


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

    constructor() {
        const config = useRuntimeConfig();
        
        this.endpoint = config.public.frogger.endpoint;

        //@ts-expect-error
        this.batchingEnabled = config.public?.frogger?.batch !== false;

        if (!this.batchingEnabled) return;

        this.maxBatchSize = config.public.frogger.batch?.maxSize;
        this.maxBatchAge = config.public.frogger.batch?.maxAge;
        this.maxQueueSize = config.public.frogger.batch?.maxSize;
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
        }
        
        this.scheduleSend();
    }

    /**
     * Schedule sending logs to the server
     */
    private scheduleSend(): void {
        if (!this.batchingEnabled) return;

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
                app: this.appInfo
            };
            
            console.log('Sending log batch:', batch);
            await $fetch(this.endpoint, {
                method: 'POST',
                body: batch
            });
        }
        catch (error) {
            console.error('Failed to send logs:', error);
            if (!this.batchingEnabled || !this.maxQueueSize) return;

            // Put the logs back in the queue
            this.queue = [...logs, ...this.queue].slice(-this.maxQueueSize);
        }
        finally {
            this.sending = false;
            
            if (this.queue.length > 0) {
                this.scheduleSend();
            }
        }
    }

    /**
     * Send a single log immediately (used when batching is disabled)
     */
    private async sendLogImmediately(log: LoggerObject): Promise<void> {
        if (!this.endpoint) return;

        const batch: LoggerObjectBatch = {
            logs: [log],
            app: this.appInfo
        };

        try {
            console.log('Sending single log immediately:', batch);
            await $fetch(this.endpoint, {
                method: 'POST',
                body: batch
            });
        }
        catch (error) {
            console.error('Failed to send log immediately:', error);
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