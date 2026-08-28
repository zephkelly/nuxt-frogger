import { useFroggerConfig, useFroggerServerConfig } from '../../shared/utils/use-frogger-config';
import { parseAppInfoConfig } from "../../app-info/parse";

import { generateW3CTraceHeaders } from "../../shared/utils/trace-headers";
import { splitLoggerBatch } from "../../shared/utils/split-batch";
import { toOtlpLogs } from "./otlp-shape";

import type { IFroggerTransport } from "./types";
import type { LoggerObject } from "../../shared/types/log";
import type { LoggerObjectBatch } from "../../shared/types/batch";
import { LOG_BATCH_SCHEMA } from "../../shared/types/batch";
import type { FroggerResource } from "../../shared/types/resource";
import type { SpanObject } from "../../shared/types/span";

import { uuidv7 } from '../../shared/utils/uuid';
import { froggerInternal } from '../../shared/utils/internal-log';
import { backoffDelay, retryAfterMs } from '../../shared/utils/backoff';
import { recordDelivered, recordDropped } from '../../shared/utils/health';



export interface HttpTransportOptions {
    endpoint: string;
    baseUrl?: string;

    /**
     * Wire shape for the request body.
     *
     * - `'frogger'` (default): `{ logs, spans, app, resource, meta }`, the
     *   format nuxt-observe consumes.
     * - `'otlp-logs'`: an OTLP/HTTP `ExportLogsServiceRequest`, which reaches
     *   the OTel Collector, Alloy, SigNoz, Datadog, Axiom, Better Stack and
     *   ClickStack without any of them knowing what Frogger is.
     *
     * A pure mapping applied just before the POST, so retry, backoff, chunking
     * and 4xx-drop behaviour are identical either way.
     */
    shape?: 'frogger' | 'otlp-logs';

    /**
     * `tracestate` vendor key for this destination's entry. Defaults to
     * `frogger`.
     *
     * This was assigned and never read: every outgoing `tracestate` was written
     * under the hardcoded key `frogger`, so pointing two transports at
     * different vendors produced identical headers.
     */
    vendor?: string;
    headers?: Record<string, string>;
    /** Sent on every batch POST. Location is controlled by `apiKeyLocation`. */
    apiKey?: string;
    /**
     * Where the API key is sent. `'header'` (default) → `x-api-key`; `'query'`
     * → `?key=` on the request URL (for ingest APIs whose CORS design expects a
     * bare browser `$fetch` with no custom headers, e.g. nuxt-observe).
     */
    apiKeyLocation?: 'header' | 'query';
    timeout?: number;
    retryOnFailure?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    /** Split outgoing batches so no chunk exceeds this many events. 0 = no cap. */
    maxBatchEvents?: number;
    /** Split outgoing batches so no chunk's JSON body exceeds this. 0 = no cap. */
    maxBodyBytes?: number;
    appInfo?: {
        name: string;
        version?: string;
    };
}

export const defaultHttpTransportOptions: HttpTransportOptions = {
    endpoint: '',
    shape: 'frogger',
    vendor: 'frogger',
    headers: {},
    apiKey: '',
    apiKeyLocation: 'header',
    timeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 1000,
    maxBatchEvents: 0,
    maxBodyBytes: 0,
    //@ts-ignore
    appInfo: {}
};


/**
 * Transport that posts logs directly to an endpoint
 */
export class HttpTransport implements IFroggerTransport {
    public readonly name = 'FroggerHttpTransport';
    public readonly transportId: string;

    private options: Required<HttpTransportOptions>;
    private retries: Map<string, number> = new Map();
    private readonly resource: FroggerResource | undefined;

    constructor(options: HttpTransportOptions) {
        this.transportId = `frogger-http-${uuidv7()}`;

        const config = useFroggerConfig()
        const { isSet, name, version } = parseAppInfoConfig(config.app);
        // Prefer the server resource (it carries this boot's instance id); the
        // public block is the client-side fallback.
        this.resource = useFroggerServerConfig().resource ?? config.resource;

        this.options = {
            endpoint: options.endpoint,
            baseUrl: options.baseUrl || config.baseUrl || '',
            shape: options.shape || 'frogger',
            vendor: options.vendor || 'frogger',
            appInfo: isSet ? {
                name: name || 'unknown',
                version
            } : {
                name: 'unknown',
                version: 'unknown'
            },
            headers: {
                ...options.headers
            },
            apiKey: options.apiKey || '',
            apiKeyLocation: options.apiKeyLocation || 'header',
            timeout: options.timeout || 30000,
            retryOnFailure: options.retryOnFailure ?? true,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            maxBatchEvents: options.maxBatchEvents || 0,
            maxBodyBytes: options.maxBodyBytes || 0
        };

        if (!this.options.endpoint) {
            throw new Error('HttpReporter requires an endpoint');
        }
    }

    async log(logObj: LoggerObject): Promise<void> {
        await this.sendBatch(this.addBatchMetadata({
            logs: [logObj],
            app: this.options.appInfo
        }));
    }

    /**
     * Stamp the envelope for this hop. `processChain` APPENDS: rebuilding it as
     * a fresh one-element array made the receiver's duplicate-hop check
     * unreachable, so a genuine A -> B -> A loop could only ever be caught by
     * the staleness heuristic.
     */
    private addBatchMetadata(logBatch: LoggerObjectBatch): LoggerObjectBatch {
        const chain = logBatch.meta?.processChain ?? [];

        return {
            ...logBatch,
            resource: logBatch.resource ?? this.resource,
            meta: {
                ...logBatch.meta,
                schema: LOG_BATCH_SCHEMA,
                processed: true,
                processChain: [...chain, this.transportId],
                source: this.options.appInfo.name,
                time: Date.now()
            }
        };
    }

    async logBatch(logs: LoggerObject[], spans?: SpanObject[]): Promise<void> {
        if (logs.length === 0 && (!spans || spans.length === 0)) {
            return;
        }

        await this.sendBatch(this.addBatchMetadata({
            logs,
            ...(spans && spans.length > 0 ? { spans } : {}),
            app: this.options.appInfo
        }));
    }

    private async sendBatch(batch: LoggerObjectBatch): Promise<void> {
        const chunks = (this.options.maxBatchEvents || this.options.maxBodyBytes)
            ? splitLoggerBatch(batch, {
                maxEvents: this.options.maxBatchEvents || undefined,
                maxBytes: this.options.maxBodyBytes || undefined,
            })
            : [batch];

        for (const chunk of chunks) {
            await this.sendChunk(chunk);
        }
    }

    private async sendChunk(batch: LoggerObjectBatch): Promise<void> {
        const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
            await this.performHttpRequest(batch);
            recordDelivered(batch.logs.length);
            this.retries.delete(batchId);
        }
        catch (error) {
            // A non-429 4xx is a deterministic client error (bad key/schema) —
            // retrying can't help, so drop immediately (logged once).
            if (this.isDropError(error)) {
                froggerInternal.warn(
                    `HttpTransport: destination rejected the batch (${this.statusOf(error)}). Dropping ${batch.logs.length} logs.`
                );
                recordDropped('rejected4xx', batch.logs.length, `${this.options.endpoint} rejected the batch (${this.statusOf(error)})`);
                this.retries.delete(batchId);
                return;
            }

            if (this.options.retryOnFailure) {
                await this.handleSendFailure(batchId, batch, error);
            }
            else {
                froggerInternal.error(
                    `HttpTransport: failed to send logs (retries disabled). Dropping ${batch.logs.length} logs.`,
                    error
                );
                recordDropped('retriesExhausted', batch.logs.length, 'retries disabled on this transport');
            }
        }
    }

    private statusOf(error: unknown): number | undefined {
        //@ts-ignore — FetchError shape
        return error?.response?.status ?? (error as { statusCode?: number })?.statusCode;
    }

    /** A non-429 4xx means the request itself is bad — retrying won't help. */
    private isDropError(error: unknown): boolean {
        const status = this.statusOf(error);
        return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
    }


    private createRequestHeaders(batch: LoggerObjectBatch): Record<string, string> {
        const firstLog = batch.logs[0];
        const traceContext = firstLog?.trace;

        const w3cHeaders = generateW3CTraceHeaders({
            traceId: traceContext?.traceId,
            parentSpanId: traceContext?.spanId,
            // Honours the configured vendor key rather than hardcoding
            // `frogger`, which is what made the option inert.
            vendorData: { [this.options.vendor || 'frogger']: this.transportId }
        });

        const headers: Headers = new Headers({
            // User-configured headers first, so Frogger's own trace/identity
            // headers below always win over anything that would clobber them.
            ...this.options.headers,

            'x-frogger-reporter-id': this.transportId,
            'x-frogger-processed': 'true',

            'traceparent': w3cHeaders.traceparent,
            ...(w3cHeaders.tracestate && { tracestate: w3cHeaders.tracestate })
        });

        if (this.options.apiKey && this.options.apiKeyLocation !== 'query') {
            headers.set('x-api-key', this.options.apiKey);
        }

        if (this.options.appInfo) {
            headers.set('x-frogger-source', this.options.appInfo.name);
        }

        return Object.fromEntries(headers.entries());
    }

    /**
     * Perform a single POST. Throws on any failure ($fetch throws `FetchError`,
     * not `H3Error`) so the caller's retry/drop machinery actually runs — the
     * old body swallowed every error, which silently dropped failed sends.
     */
    private async performHttpRequest(batch: LoggerObjectBatch): Promise<void> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        try {
            const headers = this.createRequestHeaders(batch);

            await $fetch(this.options.endpoint, {
                baseURL: this.options.baseUrl || undefined,
                method: 'POST',
                headers: headers,
                query: this.options.apiKeyLocation === 'query' && this.options.apiKey
                    ? { key: this.options.apiKey }
                    : undefined,
                // The ONE place the shape is applied: everything above this
                // line - retry, backoff, chunking, drop classification - is
                // shape-agnostic and stays that way.
                body: this.options.shape === 'otlp-logs' ? toOtlpLogs(batch) : batch,
                signal: controller.signal
            });
        }
        finally {
            clearTimeout(timeoutId);
        }
    }

    private async handleSendFailure(batchId: string, batch: LoggerObjectBatch, error?: unknown): Promise<void> {
        const retryCount = this.retries.get(batchId) || 0;

        if (retryCount >= this.options.maxRetries) {
            froggerInternal.error(`HttpTransport: maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${batch.logs.length} logs.`);
            recordDropped('retriesExhausted', batch.logs.length, `${this.options.endpoint} failed after ${this.options.maxRetries} retries`);
            this.retries.delete(batchId);
            return;
        }

        this.retries.set(batchId, retryCount + 1);

        // Jittered: without it every instance retries a recovering sink at the
        // same instant, and its first moment of recovery is the next herd.
        const delay = retryAfterMs(error)
            ?? backoffDelay(retryCount, { baseMs: this.options.retryDelay });

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.performHttpRequest(batch);
            this.retries.delete(batchId);
        }
        catch (error) {
            // A 4xx surfacing mid-retry is still a deterministic client error.
            if (this.isDropError(error)) {
                froggerInternal.warn(
                    `HttpTransport: destination rejected the batch (${this.statusOf(error)}). Dropping ${batch.logs.length} logs.`
                );
                recordDropped('rejected4xx', batch.logs.length, `${this.options.endpoint} rejected the batch (${this.statusOf(error)})`);
                this.retries.delete(batchId);
                return;
            }
            await this.handleSendFailure(batchId, batch, error);
        }
    }

    async destroy(): Promise<void> {
        this.retries.clear();
    }

    setAppInfo(name: string, version: string): void {
        this.options.appInfo = { name, version };
    }

    setEndpoint(endpoint: string): void {
        this.options.endpoint = endpoint;
    }

    getRetryCount(): number {
        return Array.from(this.retries.values()).reduce((sum, count) => sum + count, 0);
    }
}