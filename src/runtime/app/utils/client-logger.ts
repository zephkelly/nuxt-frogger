import { useNuxtApp, useState } from '#app';

import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import { LogQueueService } from '../services/log-queue';

import type { ClientLoggerOptions } from '../types/logger';
import type { LogObject } from 'consola/browser';
import type { LoggerObject } from '../../shared/types/log';
import type { LogBatch } from '../../shared/types/batch';

import { useRuntimeConfig } from '#app';


interface SSRTraceState {
    traceId: string;
    lastServerSpanId: string | null;
    isClientHydrated: boolean;
}

/**
 * Client-side implementation of Frogger
 * Batches logs and sends them to a server endpoint
 */
export class ClientFrogger extends BaseFroggerLogger {
    private options: Required<ClientLoggerOptions>;
    
    constructor(options: ClientLoggerOptions = {}) {
        super(options);

        const config = useRuntimeConfig();

        this.options = {
            endpoint: config.public.frogger.endpoint,

            level: 3,
            context: {},
            consoleOutput: true,
            ...options
        }

        // this.options = defu(options, config.public.frogger.batch) as Required<ClientLoggerOptions>;
        
        // const  = {
        //     endpoint: options.endpoint ?? '/api/_frogger/logs',
        //     maxBatchSize: options.maxBatchSize ?? 10,
        //     maxBatchAge: options.maxBatchAge ?? 3000,
        //     maxQueueSize: options.maxQueueSize ?? 100,
        //     appName: options.appName ?? 'unknown',
        //     version: options.version ?? 'unknown',
        //     level: options.level ?? 3,
        //     context: options.context ?? {},
        //     consoleOutput: options.consoleOutput ?? true
        // };
        
        this.setupTraceContext();
        
        if (import.meta.client) {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            
            // logQueue.configure({
            //     endpoint: this.options.endpoint,
            //     maxBatchSize: this.options.maxBatchSize,
            //     maxBatchAge: this.options.maxBatchAge,
            //     maxQueueSize: this.options.maxQueueSize
            // });
            
            logQueue.setAppInfo('unknown', 'unknown');
        }
    }

    /**
     * Set up trace context continuity across SSR-CSR boundary
     * ONLY the initial client hydration shares the trace ID with SSR
     */
    private setupTraceContext(): void {
        const ssrTraceState = useState<SSRTraceState>('frogger-ssr-trace-state', () => ({
            traceId: '',
            lastServerSpanId: null,
            isClientHydrated: false
        }));
        
        if (import.meta.server) {
            // On server: store the trace ID and span ID for client hydration
            ssrTraceState.value = {
                traceId: this.traceId,
                lastServerSpanId: null,  // Will be updated after first log
                isClientHydrated: false
            };
        }
        else {
            // This is the initial client hydration - use the SSR trace ID
            if (ssrTraceState.value.traceId && !ssrTraceState.value.isClientHydrated) {
                this.setTraceContext(
                    ssrTraceState.value.traceId,
                    ssrTraceState.value.lastServerSpanId
                );
                
                // Mark that hydration has occurred so future instances get new trace IDs
                ssrTraceState.value.isClientHydrated = true;
            }

            // For all other client instances, we keep the new randomly generated trace ID
            // from the BaseFroggerLogger constructor (no action needed)
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected async processLog(logObj: LogObject): Promise<void> {
        const traceContext = this.generateTraceContext();

        if (import.meta.server) {
            // On server: update the last server span ID
            const ssrTraceState = useState<SSRTraceState>('frogger-ssr-trace-state');
            ssrTraceState.value = {
                ...ssrTraceState.value,
                lastServerSpanId: this.lastSpanId
            };
        }

        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            level: logObj.level,
            
            date: logObj.date,

            trace: traceContext,

            context: {
                env: (import.meta.server) ? 'ssr' : 'client',
                message: logObj.args?.[0],
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            timestamp: logObj.date.getTime(),
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
                    name: 'unknown',
                    version: 'unknown'
                }
            };

            // Immediately send the log batch to the server while we are on the server
            // to prevent any loss of logs
            if (!this.options.endpoint) return;

            await $fetch(this.options.endpoint, {
                method: 'POST',
                body: batch
            });
        }
    }
}