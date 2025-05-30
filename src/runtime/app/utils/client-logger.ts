import { type Ref } from 'vue';
import { useNuxtApp, useState, useRuntimeConfig } from '#app';

import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import { LogQueueService } from '../services/log-queue';

import type { ClientLoggerOptions } from '../types/logger';
import type { LogObject } from 'consola/browser';
import type { LoggerObject } from '../../shared/types/log';
import type { LogBatch } from '../../shared/types/batch';



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
    protected hasMounted: Ref<boolean>;

    private ssrTraceState = useState<SSRTraceState>('frogger-ssr-trace-state');
    
    constructor(hasMounted: Ref<boolean>, options: ClientLoggerOptions = {}) {
        super(options);

        this.hasMounted = hasMounted;


        const config = useRuntimeConfig();

        this.options = {
            endpoint: config.public.frogger.endpoint,

            level: 3,
            context: {},
            consoleOutput: true,
            ...options
        }
        
        this.setupTraceContext();
        
        if (import.meta.client) {
            const nuxtApp = useNuxtApp();
            const logQueue = nuxtApp.$logQueue as LogQueueService;
            
            logQueue.setAppInfo('unknown', 'unknown');
        }
    }

    /**
     * Set up trace context continuity across SSR-CSR boundary
     * ONLY the initial client hydration shares the trace ID with SSR
     */
    private setupTraceContext(): void {
        this.ssrTraceState.value = this.ssrTraceState.value || {
            traceId: '',
            lastServerSpanId: null,
            isClientHydrated: false
        };
        
        if (import.meta.server) {
            // On server: store the trace ID and span ID for client hydration
            this.ssrTraceState.value = {
                traceId: this.traceId,
                lastServerSpanId: null,  // Will be updated after first log
                isClientHydrated: false
            };
        }
        else {
            // This is the initial client hydration - use the SSR trace ID
            if (this.ssrTraceState.value.traceId && !this.ssrTraceState.value.isClientHydrated) {
                this.setTraceContext(
                    this.ssrTraceState.value.traceId,
                    this.ssrTraceState.value.lastServerSpanId
                );
                
                this.ssrTraceState.value.isClientHydrated = true;
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
            this.ssrTraceState.value = {
                ...this.ssrTraceState.value,
                lastServerSpanId: this.lastSpanId
            };
        }

        const env = (import.meta.server) ? 'ssr' :
            (import.meta.client && this.hasMounted.value) ? 'client' : 'csr';

        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            level: logObj.level,
            
            date: logObj.date,

            trace: traceContext,

            context: {
                env: env,
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