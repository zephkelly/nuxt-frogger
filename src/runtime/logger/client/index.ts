import { type Ref } from 'vue';
import { useNuxtApp, useState } from '#imports';
import { useFroggerConfig } from '../../shared/utils/use-frogger-config';
import { resolveSession } from '../../shared/session';
import { notifyIdentity } from '../../shared/utils/identity-sink';
import type { FroggerResource } from '../../shared/types/resource';

import { BaseFroggerLogger } from '../base-frogger';
import { getLogQueue } from '../../app/services/get-log-queue';

import type { IFroggerLogger } from '../types';
import type { ClientLoggerOptions, SSRTraceState } from './types';
import type { LogObject } from 'consola/browser';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import { levelOf, severityOf } from '../../shared/types/log';
import { eventKind } from '../../shared/utils/event-kind';
import type { LoggerObjectBatch } from '../../shared/types/batch';
import { LOG_BATCH_SCHEMA } from '../../shared/types/batch';
import { parseAppInfoConfig } from '../../app-info/parse';
import { uuidv7 } from '../../shared/utils/uuid';

import { hasPrimaryLogSink } from '../../shared/utils/primary-sink';
import { normalizeContextErrors } from '../../shared/utils/normalize-errors';
import { runSpanWithEvent, type SpanOptions } from '../../shared/utils/span-events';
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
    private readonly resource: FroggerResource | undefined;
    protected hasMounted: Ref<boolean>;
    private batchingEnabled = true;

    private ssrTraceState = useState<SSRTraceState>('frogger-ssr-trace-state');

    constructor(hasMounted: Ref<boolean>, options: ClientLoggerOptions = {}) {
        super(options);

        this.hasMounted = hasMounted;

        const config = useFroggerConfig();

        if (config.serverModule) {
            this.serverModuleEnabled = true;
        }

        this.resource = config.resource;

        const { isSet, name, version } = parseAppInfoConfig(config.app);

        this.appInfo = isSet ? {
            name: name,
            version: version
        } : undefined;

        this.options = {
            endpoint: config.endpoint,
            baseUrl: config.baseUrl || '',

            level: 3,
            context: {},
            // Scrub is opt-in: follow whatever the resolved runtime config says
            // (`false` when off, a config object when on). A per-logger
            // `useFrogger({ scrub: true })` in `...options` still overrides this.
            scrub: config.scrub ?? false,
            ...options,
            // The RESOLVED value the base constructor already computed, not the
            // raw option. Children inherit `this.options`, so hardcoding `true`
            // here would re-materialise an explicit `true` that outranks a
            // module-wide `consoleOutput: false` for every child and span.
            // Assigned after the spread so an explicit `{ consoleOutput:
            // undefined }` cannot clobber the resolution.
            consoleOutput: this.consoleOutput,
        }

        this.batchingEnabled = config.batch !== false;

        // The session is shared with the metrics pipeline, so a log and a Web
        // Vital from the same page load can be joined on it. Client-only: on
        // the server there is no tab to have a session.
        if (import.meta.client) {
            this.session = resolveSession(1)
        }

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
            // The server logger's span IS the SSR unit of work, and it is
            // stable, so the handoff value is known here rather than needing to
            // be re-written after every log.
            this.ssrTraceState.value = {
                traceId: this.traceId,
                lastServerSpanId: this.spanId,
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
    /**
     * Identify the acting user for logs AND metrics in one call.
     *
     * The metrics queue keeps its own copy because it stamps points outside the
     * logger entirely; forwarding here is what stops the two pipelines
     * disagreeing about who is acting.
     */
    override identify(user: string | { id: string, [key: string]: unknown } | null): void {
        super.identify(user);
        notifyIdentity(this.user);
    }

    protected async createLoggerObject(logObj: LogObject): Promise<LoggerObject> {
        const traceContext = this.generateTraceContext();

        const env = (import.meta.server) ? 'ssr' :
            (import.meta.client && this.hasMounted.value) ? 'client' : 'csr';

        return {
            id: uuidv7(),
            time: logObj.date.getTime(),
            // Derived from `type`, never copied off consola's LogObject: consola
            // uses ±Infinity for silent/verbose, which JSON-serialise to null.
            lvl: levelOf(logObj.type),
            sev: severityOf(logObj.type),
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
            ...this.correlationFields(),
            ...eventKind(logObj.args?.slice(1)[0]),
        };
    }

    private async sendLogImmediate(logObj: LoggerObject): Promise<void> {
        // Same gate as the batch queue's primary send: a relay app (baseUrl
        // set) MUST send here too, or the unbatched/fallback path silently
        // drops logs the queue path would have delivered.
        if (!hasPrimaryLogSink({
            serverModuleEnabled: this.serverModuleEnabled,
            endpoint: this.options.endpoint,
            baseUrl: this.options.baseUrl,
        })) return;

        const batch: LoggerObjectBatch = {
            logs: [logObj],
            app: this.appInfo,
            resource: this.resource,
            meta: {
                schema: LOG_BATCH_SCHEMA,
                time: Date.now(),
            }
        };

        // `hasPrimaryLogSink` above already returned for `endpoint: false`, so
        // this is a string by the time we get here.
        return $fetch(this.options.endpoint as string, {
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
        this.inheritCorrelation(child);

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

    public span<T>(name: string, fn: () => T | Promise<T>, options?: SpanOptions): Promise<T> {
        const child = this.startSpan(name);
        return runSpanWithEvent(child, name, this.spanEvents, () => runWithLogger(child, fn), this.spanMetricEnd(name, options), options);
    }
}