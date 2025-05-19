import type { LogObject } from 'consola/browser';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';

import type { ClientLoggerOptions } from '../types/logger';
import type { LoggerObject } from '../../shared/types';

import { useNuxtApp } from '#app';

import { LogQueueService } from '../services/log-queue';

import type { LogBatch } from '../types/logger';



interface TraceState {
    traceId: string;
    lastSpanId: string | null;
}

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
        
        this.setupTraceContext();
        
        if (import.meta.client) {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            
            logQueue.configure({
                endpoint: this.options.endpoint,
                maxBatchSize: this.options.maxBatchSize,
                maxBatchAge: this.options.maxBatchAge,
                maxQueueSize: this.options.maxQueueSize
            });
            
            logQueue.setAppInfo(this.options.appName, this.options.version);
            
            if (this.options.captureErrors) {
                window.addEventListener('error', this.handleGlobalError.bind(this));
                window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
            }
        }
    }

    /**
     * Set up trace context continuity across SSR-CSR boundary
     * Uses useState internally to persist and share the trace context
     */
    private setupTraceContext(): void {
        const traceState = useState<TraceState>('frogger-trace-state', () => ({
            traceId: this.traceId,
            lastSpanId: null
        }));
        
        if (import.meta.server) {
            traceState.value = {
                traceId: this.traceId,
                lastSpanId: null
            };
        }
        else {
            if (traceState.value.traceId) {
                this.setTraceContext(
                    traceState.value.traceId,
                    traceState.value.lastSpanId
                );
            }
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected async processLog(logObj: LogObject): Promise<void> {
        const traceContext = this.generateTraceContext();

        if (import.meta.server) {
            const traceState = useState<TraceState>('frogger-trace-state');
            traceState.value = {
                traceId: this.traceId,
                lastSpanId: this.lastSpanId
            };
        }

        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            date: new Date(),
            level: logObj.level,

            trace: traceContext,

            context: {
                env: (import.meta.server) ? 'ssr' : 'client',
                message: logObj.args?.[0],
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            timestamp: Date.now(),
        }
        
        if (import.meta.client) {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            logQueue.enqueueLog(froggerLoggerObject);
        }
        else {
            const batch: LogBatch = {
                logs: [froggerLoggerObject],
                app: {
                    name: this.options.appName,
                    version: this.options.version
                }
            };

            await $fetch(this.options.endpoint, {
                method: 'POST',
                body: batch
            });
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