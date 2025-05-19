import type { LogObject } from 'consola/browser';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';

import type { ClientLoggerOptions } from '../types/logger';
import { generateSpanId } from '../../shared/utils/tracing';
import type { LoggerObject } from '../../shared/types';


/**
 * Client-side implementation of Frogger
 * Batches logs and sends them to a server endpoint
 */
export class ClientFrogger extends BaseFroggerLogger {
    private options: Required<ClientLoggerOptions>;
    private queue: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    
    constructor(options: ClientLoggerOptions = {}) {
        super(options);
        
        this.options = {
            endpoint: options.endpoint ?? '/api/_frogger/logs',
            maxBatchSize: options.maxBatchSize ?? 10,
            maxBatchAge: options.maxBatchAge ?? 3000,
            maxQueueSize: options.maxQueueSize ?? 100,
            appName: options.appName ?? 'unknown',
            version: options.version ?? 'unknown',
            captureErrors: options.captureErrors ?? true,
            captureConsole: options.captureConsole ?? false,
            level: options.level ?? 3,
            context: options.context ?? {},
        };
        
        if (this.options.captureErrors && typeof window !== 'undefined') {
            window.addEventListener('error', this.handleGlobalError.bind(this));
            window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            date: new Date(),
            level: logObj.level,

            trace: {
                traceId: this.traceId,
                spanId: generateSpanId()
            },

            context: {
                message: logObj.args?.[0] || logObj.message,
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            timestamp: Date.now(),
        }
        
        this.queue.push(froggerLoggerObject);
        
        if (this.queue.length > this.options.maxQueueSize) {
            this.queue = this.queue.slice(-this.options.maxQueueSize);
        }
        
        this.scheduleSend();
    }
    
    /**
     * Schedule sending logs to the server
     */
    private scheduleSend(): void {
        if (this.queue.length >= this.options.maxBatchSize) {
            this.sendLogs();
            return;
        }
        
        if (this.timer !== null) {
            return;
        }
        
        this.timer = setTimeout(() => {
            this.timer = null;
            this.sendLogs();
        }, this.options.maxBatchAge);
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
            if (!this.options.endpoint) {
                console.warn('No endpoint specified for sending logs');
                return;
            }
            await $fetch(this.options.endpoint, {
                method: 'POST',
                body: {
                    logs,
                    app: {
                        name: this.options.appName,
                        version: this.options.version
                    }
                }
            });
        }
        catch (error) {
            console.error('Failed to send logs:', error);
            this.queue = [...logs, ...this.queue].slice(-this.options.maxQueueSize);
        }
        finally {
            this.sending = false;
            
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