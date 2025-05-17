import type { LogObject } from 'consola/browser';
import { BaseFrogger } from '../../shared/utils/frogger';

import type { ClientLoggerOptions, QueuedLog } from '../types/logger';



/**
 * Client-side implementation of Frogger
 * Batches logs and sends them to a server endpoint
 */
export class ClientFrogger extends BaseFrogger {
    private options: Required<ClientLoggerOptions>;
    private queue: QueuedLog[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    
    constructor(options: ClientLoggerOptions = {}) {
        super(options);
        
        this.options = {
            endpoint: options.endpoint ?? '/api/_logger/logs',
            maxBatchSize: options.maxBatchSize ?? 10,
            maxBatchAge: options.maxBatchAge ?? 3000,
            maxQueueSize: options.maxQueueSize ?? 100,
            appName: options.appName ?? 'unknown',
            version: options.version ?? 'unknown',
            captureErrors: options.captureErrors ?? true,
            captureConsole: options.captureConsole ?? false,
            level: options.level ?? 3,
            context: options.context ?? {}
        };
        
        // Set up error capture if enabled
        if (this.options.captureErrors && typeof window !== 'undefined') {
            window.addEventListener('error', this.handleGlobalError.bind(this));
            window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        // Enqueue the log
        this.enqueueLog(logObj.type, logObj.args || []);
    }
    
    /**
     * Add a log entry to the queue
     */
    private enqueueLog(type: string, args: any[]): void {
        // Create the queued log entry
        const log: QueuedLog = {
            type,
            args,
            timestamp: Date.now(),
            traceId: this.traceId,
            spanId: this.spanId,
            context: { ...this.context }
        };
        
        // Add to queue
        this.queue.push(log);
        
        // Cap queue size if needed
        if (this.queue.length > this.options.maxQueueSize) {
            this.queue = this.queue.slice(-this.options.maxQueueSize);
        }
        
        // Schedule sending
        this.scheduleSend();
    }
    
    /**
     * Schedule sending logs to the server
     */
    private scheduleSend(): void {
        // If already at max batch size, send immediately
        if (this.queue.length >= this.options.maxBatchSize) {
            this.sendLogs();
            return;
        }
        
        // If a timer is already set, do nothing
        if (this.timer !== null) {
            return;
        }
        
        // Set a timer to send after the max age
        this.timer = setTimeout(() => {
            this.timer = null;
            this.sendLogs();
        }, this.options.maxBatchAge);
    }
    
    /**
     * Send logs to the server endpoint
     */
    private async sendLogs(): Promise<void> {
        // If no logs or already sending, do nothing
        if (this.queue.length === 0 || this.sending) {
            return;
        }
        
        // Clear any existing timer
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        // Mark as sending to prevent concurrent sends
        this.sending = true;
        
        // Get logs to send and clear queue
        const logs = [...this.queue];
        this.queue = [];
        
        try {
            // Send logs to endpoint
            await fetch(this.options.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    logs,
                    app: {
                        name: this.options.appName,
                        version: this.options.version
                    }
                })
            });
        } catch (error) {
            // If sending fails, put logs back in queue
            // (in a real implementation, you'd add retry logic)
            console.error('Failed to send logs:', error);
            this.queue = [...logs, ...this.queue].slice(-this.options.maxQueueSize);
        } finally {
            // Reset sending flag
            this.sending = false;
            
            // If new logs arrived during sending, schedule another send
            if (this.queue.length > 0) {
                this.scheduleSend();
            }
        }
    }
    
    /**
     * Handle global uncaught errors
     */
    private handleGlobalError(event: ErrorEvent): void {
        this.error('[UNCAUGHT ERROR]', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack
        });
    }
    
    /**
     * Handle unhandled promise rejections
     */
    private handlePromiseRejection(event: PromiseRejectionEvent): void {
        this.error('[UNHANDLED REJECTION]', {
            reason: event.reason
        });
    }
}