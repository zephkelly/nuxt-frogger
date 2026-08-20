import { type Ref } from 'vue';
import { useNuxtApp, useState, useRuntimeConfig } from '#imports';

import { BaseFroggerLogger } from '../base-frogger';
import { getLogQueue } from '../../app/services/get-log-queue';

import type { IFroggerLogger } from '../types';
import type { ClientLoggerOptions, SSRTraceState } from './types';
import type { LogObject } from 'consola/browser';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';
import { parseAppInfoConfig } from '../../app-info/parse';

import { DEFAULT_LOGGING_ENDPOINT } from '../../shared/types/module-options';
import { normalizeContextErrors } from '../../shared/utils/normalize-errors';
import { runSpanWithEvent } from '../../shared/utils/span-events';
import { runWithLogger } from '../active-context.client';
import type { FroggerOptions } from '../../shared/types/options';

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

        //@ts-ignore
        if (config.public.frogger.serverModule) {
            this.serverModuleEnabled = true;
        }

        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config.public.frogger.app);

        this.appInfo = isSet ? {
            name: name,
            version: version
        } : undefined;

        this.options = {
            //@ts-ignore
            endpoint: config.public.frogger.endpoint,
            //@ts-ignore
            baseUrl: config.public.frogger.baseUrl || '',

            level: 3,
            context: {},
            // Scrub is opt-in: follow whatever the resolved runtime config says
            // (`false` when off, a config object when on). A per-logger
            // `useFrogger({ scrub: true })` in `...options` still overrides this.
            //@ts-ignore
            scrub: config.public.frogger.scrub ?? false,
            ...options,
            // The RESOLVED value the base constructor already computed, not the
            // raw option. Children inherit `this.options`, so hardcoding `true`
            // here would re-materialise an explicit `true` that outranks a
            // module-wide `consoleOutput: false` for every child and span.
            // Assigned after the spread so an explicit `{ consoleOutput:
            // undefined }` cannot clobber the resolution.
            consoleOutput: this.consoleOutput,
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
            type: logObj.type,
            msg: logObj.args?.[0],
            // Errors in ctx are flattened to JSON-safe objects here, or their
            // non-enumerable name/message/stack vanish at the transport.
            ctx: normalizeContextErrors({
                ...this.mergedGlobalContext.value,
                ...this.globalContext.value,
                ...logObj.args?.slice(1)[0],
            }),
            env: env,
            source: this.appInfo !== undefined ? {
                name: this.appInfo.name || 'unknown',
                version: this.appInfo?.version || 'unknown',
            } : undefined,
            trace: traceContext,
        };
    }

    private async sendLogImmediate(logObj: LoggerObject): Promise<void> {
        if (!this.options.endpoint) return;
        if (this.serverModuleEnabled === false && this.options.endpoint === DEFAULT_LOGGING_ENDPOINT) return;

        const batch: LoggerObjectBatch = {
            logs: [logObj],
            app: this.appInfo
        };

        return $fetch(this.options.endpoint, {
            baseURL: this.options.baseUrl || undefined,
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
                try {
                    const nuxtApp = useNuxtApp();
                    getLogQueue(nuxtApp).enqueueLog(loggerObject);
                }
                catch (error) {
                    // A customer log must never be silently dropped because the
                    // queue path failed. Fall back to a direct send.
                    await this.deliverFallback(loggerObject, error);
                }
                return;
            }

            await this.sendLogImmediate(loggerObject);
            return;
        }

        await this.sendLogImmediate(loggerObject);
    }

    /**
     * Last-resort delivery when the batching queue path throws. Tries a direct
     * send; if that also fails, surfaces the drop on the console UNGATED — the
     * internal diagnostics channel (`froggerInternal`) is silent in production,
     * and losing a customer's log without a trace is the worst failure a logger
     * can have.
     */
    private async deliverFallback(loggerObject: LoggerObject, cause: unknown): Promise<void> {
        try {
            await this.sendLogImmediate(loggerObject);
        }
        catch (fallbackError) {
            // eslint-disable-next-line no-console
            console.error(
                '🐸 Frogger: failed to deliver a log (queue and direct send both failed).',
                { cause, fallbackError, log: loggerObject },
            );
        }
    }


    public createChild(options: ClientLoggerOptions, reactive: boolean): ClientFrogger {
        const { traceId, parentSpanId } = this.createChildTraceContext();
        const childContext = this.createChildContext(reactive);

        const childOptions: ClientLoggerOptions = {
            // Child options win; the parent's act as defaults.
            ...defu(options, this.options),
            // scrub must replace wholesale, not deep-merge: defu would
            // concatenate the two configs' rule arrays, silently re-adding
            // parent rules a child scrub object was meant to replace.
            ...(options.scrub !== undefined && { scrub: options.scrub }),
            context: reactive
                ? options.context
                // Explicit child context overrides inherited keys (a nested
                // startSpan must be able to replace the parent's `span`).
                : (defu(options.context, childContext) as LogContext),
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

    public startSpan(name: string, options: FroggerOptions = {}): IFroggerLogger {
        return this.child(defu({ context: { span: name } }, options));
    }

    public span<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
        const child = this.startSpan(name);
        return runSpanWithEvent(child, name, this.spanEvents, () => runWithLogger(child, fn));
    }
}