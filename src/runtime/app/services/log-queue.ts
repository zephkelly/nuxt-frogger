import { defineNuxtPlugin } from '#app'
import type { LoggerObject } from '../../shared/types'
import type { LogBatch } from '../types/logger';


/**
 * Centralized log queue service
 */
export class LogQueueService {
    private queue: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    private endpoint: string = '/api/_frogger/logs';
    private maxBatchSize: number = 10;
    private maxBatchAge: number = 3000;
    private maxQueueSize: number = 100;
    private appInfo: { name: string; version: string } = { 
        name: 'unknown', 
        version: 'unknown' 
    };

    constructor() {
        // Constructor is empty as we'll set options when enqueueing logs
    }

    /**
     * Set application information for the log batch
     */
    setAppInfo(name: string, version: string): void {
        this.appInfo = { name, version };
    }

    /**
     * Set queue configuration
     */
    configure(options: {
        endpoint?: string;
        maxBatchSize?: number;
        maxBatchAge?: number;
        maxQueueSize?: number;
    }): void {
        if (options.endpoint) this.endpoint = options.endpoint;
        if (options.maxBatchSize) this.maxBatchSize = options.maxBatchSize;
        if (options.maxBatchAge) this.maxBatchAge = options.maxBatchAge;
        if (options.maxQueueSize) this.maxQueueSize = options.maxQueueSize;
    }

    /**
     * Add a log to the centralized queue
     */
    enqueueLog(log: LoggerObject): void {
        this.queue.push(log);
        
        // Trim the queue if it exceeds the maximum size
        if (this.queue.length > this.maxQueueSize) {
            this.queue = this.queue.slice(-this.maxQueueSize);
        }
        
        this.scheduleSend();
    }

    /**
     * Schedule sending logs to the server
     */
    private scheduleSend(): void {
        if (this.queue.length >= this.maxBatchSize) {
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
        if (this.queue.length === 0 || this.sending) {
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
            
            const batch: LogBatch = {
                logs,
                app: this.appInfo
            };
            
            await $fetch(this.endpoint, {
                method: 'POST',
                body: batch
            });
        }
        catch (error) {
            console.error('Failed to send logs:', error);
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
}