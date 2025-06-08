import { type Ref } from 'vue';
import { useNuxtApp, useState, useRuntimeConfig } from '#app';

import { BaseFroggerLogger } from '../base-frogger';
import { LogQueueService } from '../../app/services/log-queue';

import type { IFroggerLogger } from '../types';
import type { ClientLoggerOptions, SSRTraceState } from './types';
import type { LogObject } from 'consola/browser';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';
import { parseAppInfoConfig } from '../../app-info/parse';

import { DEFAULT_LOGGING_ENDPOINT } from '../../shared/types/module-options';

import { defu } from 'defu';

/**
 * Client-side implementation of Frogger
 * Batches logs and sends them to a server endpoint
 */
export class ClientFrogger extends BaseFroggerLogger implements IFroggerLogger {
    private options: Required<ClientLoggerOptions>;
    private serverModuleEnabled = false;
    protected hasMounted: Ref<boolean>;
    private batchingEnabled = true;

    private ssrTraceState = useState<SSRTraceState>('frogger-ssr-trace-state');
    
    constructor(hasMounted: Ref<boolean>, options: ClientLoggerOptions = {}) {
        super(options);

        this.hasMounted = hasMounted;

        const config = useRuntimeConfig();

        if (config.public.frogger.serverModule) {
            this.serverModuleEnabled = true;
        }

        const { isSet, name, version } = parseAppInfoConfig(config.public.frogger.app);

        this.options = {
            appInfo: isSet ? { 
                name: name || 'unknown', 
                version 
            } : { 
                name: 'unknown',
                version: 'unknown'
            },
            endpoint: config.public.frogger.endpoint,

            level: 3,
            context: {},
            consoleOutput: true,
            scrub: config.public.frogger.scrub || true,
            ...options
        }

        //@ts-expect-error
        this.batchingEnabled = config.public.frogger.batch !== false;
        
        this.setupTraceContext();
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
        }
    }

    /**
     * Create LoggerObject from Consola's LogObject
     */
    protected async createLoggerObject(logObj: LogObject): Promise<LoggerObject> {
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

        return {
            time: logObj.date.getTime(),
            lvl: logObj.level,
            msg: logObj.args?.[0],
            ctx: {
                ...this.mergedGlobalContext.value,
                ...this.globalContext.value,
                ...logObj.args?.slice(1)[0],
            },
            env: env,
            type: logObj.type,
            trace: traceContext,
        };
    }

    private async sendLogImmediate(logObj: LoggerObject): Promise<void> {
        if (!this.options.endpoint) return;
        if (this.serverModuleEnabled === false && this.options.endpoint === DEFAULT_LOGGING_ENDPOINT) return;

        const batch: LoggerObjectBatch = {
            logs: [logObj],
            app: this.options.appInfo
        };

        return $fetch(this.options.endpoint, {
            method: 'POST',
            body: batch,
            headers: {
                ...this.getHeaders()
            }
        });
    }
    
    protected async processLoggerObject(loggerObject: LoggerObject): Promise<void> {
        if (import.meta.client) {
            if (this.batchingEnabled) {
                const nuxtApp = useNuxtApp();

                const logQueue = nuxtApp.$logQueue as LogQueueService;
                logQueue.enqueueLog(loggerObject);
                return;
            }

            await this.sendLogImmediate(loggerObject);
            return;
        }
        
        await this.sendLogImmediate(loggerObject);
    }


    public createChild(options: ClientLoggerOptions, reactive: boolean): ClientFrogger {
        const { traceId, parentSpanId } = this.createChildTraceContext();
        const childContext = this.createChildContext(reactive);

        const childOptions: ClientLoggerOptions = {
            ...defu(this.options, options),
            context: reactive 
                ? options.context
                : (defu(childContext, options.context) as LogContext),
        };

        const child = new ClientFrogger(this.hasMounted, childOptions);
        
        child.setTraceContext(traceId, parentSpanId);

        if (reactive) {
            child.parentGlobalContext = this.mergedGlobalContext;
        }

        return child;
    }

    public child(options: ClientLoggerOptions): ClientFrogger {
        return this.createChild(options, false);
    }

    public reactiveChild(options: ClientLoggerOptions): ClientFrogger {
        return this.createChild(options, true);
    }
}