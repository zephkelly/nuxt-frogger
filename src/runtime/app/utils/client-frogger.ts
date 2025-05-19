import type { LogObject } from 'consola/browser';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';

import type { ClientLoggerOptions } from '../types/logger';
import { generateSpanId } from '../../shared/utils/tracing';
import type { LoggerObject } from '../../shared/types';

import { useNuxtApp } from '#app';

import { LogQueueService } from '../services/log-queue';

/**
 * Client-side implementation of Frogger
 * Batches logs and sends them to a server endpoint
 */
export class ClientFrogger extends BaseFroggerLogger {
    private options: Required<ClientLoggerOptions>;
    
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
        
        // Configure the shared log queue service
        if (typeof window !== 'undefined') {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            
            // Set the queue configuration
            logQueue.configure({
                endpoint: this.options.endpoint,
                maxBatchSize: this.options.maxBatchSize,
                maxBatchAge: this.options.maxBatchAge,
                maxQueueSize: this.options.maxQueueSize
            });
            
            // Set the app info for this batch
            logQueue.setAppInfo(this.options.appName, this.options.version);
            
            // Set up global error handlers
            if (this.options.captureErrors) {
                window.addEventListener('error', this.handleGlobalError.bind(this));
                window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
            }
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
        
        // Use the centralized log queue service to enqueue the log
        if (typeof window !== 'undefined') {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            logQueue.enqueueLog(froggerLoggerObject);
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