import { H3Error } from 'h3';

import { LogScrubber } from '../../scrubber/index';
import type { LoggerObject } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';
import type { ResolvedHttpTransport } from '../../shared/types/transports';

import { useRuntimeConfig } from '#imports';
import { uuidv7 } from '../../shared/utils/uuid';

import { handleRateLimit } from '../../rate-limiter/utils/limit-handler';
import { SimpleConsoleLogger } from '../../logger/other/console-frogger';

import { parseAppInfoConfig } from '../../app-info/parse';
import { hasPrimaryLogSink } from '../../shared/utils/primary-sink';
import { froggerInternal } from '../../shared/utils/internal-log';
import { splitLoggerBatch } from '../../shared/utils/split-batch';


interface RetryState {
    count: number;
    nextRetryAt: number;
    backoffMultiplier: number;
}

export class LogQueueService {
    private scrubber: LogScrubber | null = null;

    private queue: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    private batchingEnabled: boolean = true;
    private readonly serverModuleEnabled: boolean;
    private readonly reporterId: string;

    private endpoint: string | false;
    private readonly baseUrl: string;

    /**
     * Secondary sinks from `public.frogger.transports` (client:true entries).
     * Each flush fans the same scrubbed batch out to these, independent of the
     * primary self-endpoint. ⚠️ Their apiKeys are bundle-visible by design.
     */
    private readonly clientTransports: ResolvedHttpTransport[];

    private maxBatchSize: number | undefined;
    private maxBatchAge: number | undefined;
    private maxQueueSize: number | undefined;

    private consoleLogger: SimpleConsoleLogger = new SimpleConsoleLogger()

    private appInfo: { name?: string; version?: string } | undefined = undefined;

    private retryState: RetryState = {
        count: 0,
        nextRetryAt: 0,
        backoffMultiplier: 1
    };
    private readonly maxRetries = 5;
    private readonly baseBackoffMs = 1000;
    private readonly maxBackoffMs = 300000;
    private readonly rateLimitBackoffMs = 60000;

    constructor() {
        this.reporterId = 'client-log-queue-' + uuidv7();

        const config = useRuntimeConfig();

        //@ts-ignore
        this.serverModuleEnabled = config.public.frogger.serverModule;

        //@ts-ignore
        if (config.public.frogger.scrub) {
            //@ts-ignore
            this.scrubber = new LogScrubber(config.public.frogger.scrub);
        }

        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config.public.frogger.app);

        this.appInfo = isSet ? { name, version } : { name: 'unknown', version: 'unknown' };

        //@ts-ignore
        this.endpoint = config.public.frogger.endpoint;
        //@ts-ignore
        this.baseUrl = config.public.frogger.baseUrl || '';

        //@ts-ignore
        this.clientTransports = (config.public.frogger.transports ?? []) as ResolvedHttpTransport[];

        //@ts-expect-error
        this.batchingEnabled = config.public?.frogger?.batch !== false;

        if (!this.batchingEnabled) return;

        //@ts-ignore
        this.maxBatchSize = config.public.frogger.batch?.maxSize;
        //@ts-ignore
        this.maxBatchAge = config.public.frogger.batch?.maxAge;
        //@ts-ignore
        this.maxQueueSize = config.public.frogger.batch?.maxSize;
    }

    setAppInfo(name: string, version: string): void {
        this.appInfo = { name, version };
    }

    enqueueLog(log: LoggerObject): void {
        if (!this.batchingEnabled) {
            this.sendLogImmediately(log);
            return;
        }

        this.queue.push(log);

        if (this.maxQueueSize && this.queue.length > this.maxQueueSize) {
            this.queue = this.queue.slice(-this.maxQueueSize);
            froggerInternal.warn(`Log queue exceeded maximum size of ${this.maxQueueSize}. Old logs have been discarded.`);
        }

        this.scheduleSend();
    }

    private isRateLimited(): boolean {
        return Date.now() < this.retryState.nextRetryAt;
    }

    private resetRetryState(): void {
        this.retryState = {
            count: 0,
            nextRetryAt: 0,
            backoffMultiplier: 1
        };
    }

    private handleRateLimit(error: H3Error, retryAfter?: number): boolean {
        const { rateLimitInfo, strategy, shouldRetry, delayMs } = handleRateLimit(error, {
            maxRetries: this.maxRetries,
            baseBackoffMs: this.baseBackoffMs,
            maxBackoffMs: this.maxBackoffMs,
            respectServerTiming: true,
            onRateLimit: (info, strat) => {
                this.consoleLogger.error(`Rate limit hit: ${strat.message} (Tier: ${info.tier})`);

                if (info.isBlocked) {
                    this.consoleLogger.error(`IP blocked due to rate limit. Dropping logs.`);
                }
            }
        });

        if (!rateLimitInfo.isRateLimited) {
            return false;
        }

        this.retryState.count++;
        this.retryState.nextRetryAt = Date.now() + delayMs;

        if (rateLimitInfo.isBlocked) {
            froggerInternal.error(`Dropping ${this.queue.length} logs due to IP block`);
            this.queue = [];
            this.resetRetryState();
            return true;
        }

        if (rateLimitInfo.isPaused) {
            this.retryState.backoffMultiplier = Math.min(this.retryState.backoffMultiplier * 1.5, 4);
        }
        else {
            this.retryState.backoffMultiplier = Math.min(this.retryState.backoffMultiplier * 2, 8);
        }

        if (shouldRetry && this.retryState.count < this.maxRetries) {
            setTimeout(() => {
                if (this.queue.length > 0) {
                    this.scheduleSend();
                }
            }, delayMs);
        }
        else if (this.retryState.count >= this.maxRetries) {
            froggerInternal.error(`Max retries reached for rate limiting. Dropping ${this.queue.length} logs.`);
            this.queue = [];
            this.resetRetryState();
        }

        return true;
    }

    private handleGeneralError(error: any): void {
        this.retryState.count++;

        if (this.retryState.count >= this.maxRetries) {
            froggerInternal.error(`Max retries (${this.maxRetries}) reached. Dropping ${this.queue.length} logs.`);
            this.queue = [];
            this.resetRetryState();
            return;
        }

        const backoffMs = Math.min(
            this.baseBackoffMs * Math.pow(2, this.retryState.count - 1),
            this.maxBackoffMs
        );

        this.retryState.nextRetryAt = Date.now() + backoffMs;

        froggerInternal.warn(
            `Send failed (attempt ${this.retryState.count}/${this.maxRetries}). ` +
            `Retrying in ${Math.round(backoffMs / 1000)}s. Error:`,
            error.message || error
        );

        setTimeout(() => {
            if (this.queue.length > 0) {
                this.scheduleSend();
            }
        }, backoffMs);
    }

    private scheduleSend(): void {
        if (!this.batchingEnabled) return;

        if (this.isRateLimited()) {
            return;
        }

        if (this.maxBatchSize && this.queue.length >= this.maxBatchSize) {
            this.sendLogs();
            return;
        }

        if (this.timer !== null) {
            return;
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.sendLogs();
        }, this.maxBatchAge);
    }

    /**
     * Whether the primary self-endpoint should receive this flush. A static app
     * (`serverModule:false`, default endpoint, no baseUrl) has no primary sink —
     * but it can still fan out to `client` transports, so this gates ONLY the
     * primary target, never the whole flush.
     */
    private shouldSendToPrimary(): boolean {
        // `public.endpoint: false` deliberately disables the client POST to the
        // app's own route; client transports (if any) still fan out.
        return hasPrimaryLogSink({
            serverModuleEnabled: this.serverModuleEnabled,
            endpoint: this.endpoint,
            baseUrl: this.baseUrl,
        });
    }

    private async sendLogs(): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0 || this.sending) {
            return;
        }

        const primaryEligible = this.shouldSendToPrimary();

        // Nothing anywhere to send to — leave the queue untouched.
        if (!primaryEligible && this.clientTransports.length === 0) {
            return;
        }

        // The primary's rate-limit backoff defers the whole flush (secondaries
        // piggyback on the primary's queue). A static app never advances the
        // retry state, so this never blocks a client-only fan-out.
        if (this.isRateLimited()) {
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
            if (this.scrubber) {
                this.scrubber.scrubBatch(logs);
            }

            const batch: LoggerObjectBatch = {
                logs,
                app: this.appInfo,
                meta: {
                    time: Date.now(),
                    processChain: this.appInfo?.name ? [this.appInfo.name] : [],
                }
            };

            // Fan out to secondary sinks independently — their failures never
            // touch the primary queue or its retry state.
            for (const transport of this.clientTransports) {
                void this.sendToClientTransport(transport, batch);
            }

            if (!primaryEligible) {
                this.resetRetryState();
                return;
            }

            await $fetch(this.endpoint as string, {
                baseURL: this.baseUrl || undefined,
                method: 'POST',
                body: batch,
            });

            this.resetRetryState();
        }
        catch (error: any) {
            const wasRateLimit = this.handleRateLimit(error);

            if (wasRateLimit) {
                return;
            }

            if (error.response?.status >= 400 && error.response?.status < 500) {
                froggerInternal.error(`Client error (${error.response.status}). Dropping logs to prevent retry loop.`);
                this.resetRetryState();
                return;
            }

            this.queue = [...logs, ...this.queue];
            if (this.maxQueueSize && this.queue.length > this.maxQueueSize) {
                const dropped = this.queue.length - this.maxQueueSize;
                this.queue = this.queue.slice(0, this.maxQueueSize);
                froggerInternal.warn(`Dropped ${dropped} logs due to queue overflow during retry`);
            }

            this.handleGeneralError(error);
        }
        finally {
            this.sending = false;

            if (this.queue.length > 0 && !this.isRateLimited()) {
                this.scheduleSend();
            }
        }
    }

    /**
     * Fan a batch out to one secondary client transport. When the transport
     * declares batch caps (observe: 500 events / ~1 MiB), the batch is split
     * first and each chunk is delivered with its own independent retry.
     */
    private sendToClientTransport(
        transport: ResolvedHttpTransport,
        batch: LoggerObjectBatch,
    ): void {
        const chunks = (transport.maxBatchEvents || transport.maxBodyBytes)
            ? splitLoggerBatch(batch, {
                maxEvents: transport.maxBatchEvents,
                maxBytes: transport.maxBodyBytes,
            })
            : [batch];

        for (const chunk of chunks) {
            void this.sendChunkToClientTransport(transport, chunk);
        }
    }

    /**
     * Send one chunk to a secondary client transport with independent, bounded
     * retry. Respects `Retry-After`/`429` with exponential backoff; a `4xx`
     * (bad key/schema) drops the chunk and stops retrying that sink. Never
     * re-queues onto the shared primary queue or mutates the primary retry
     * state — one remote's failure must not stall the app's own server.
     *
     * Auth follows `apiKeyLocation`: `'query'` sends a bare `$fetch` with
     * `?key=` and no `x-api-key` header (what observe's CORS design expects);
     * `'header'` (default) sends `x-api-key`.
     */
    private async sendChunkToClientTransport(
        transport: ResolvedHttpTransport,
        batch: LoggerObjectBatch,
        attempt = 0,
    ): Promise<void> {
        const url = transport.endpoint || transport.baseUrl;
        if (!url) return;

        const queryAuth = transport.apiKeyLocation === 'query';

        const headers: Record<string, string> = {
            ...transport.headers,
            ...(transport.apiKey && !queryAuth ? { 'x-api-key': transport.apiKey } : {}),
        };

        try {
            await $fetch(url, {
                baseURL: transport.baseUrl || undefined,
                method: 'POST',
                headers,
                query: queryAuth && transport.apiKey ? { key: transport.apiKey } : undefined,
                body: batch,
            });
        }
        catch (error: any) {
            const status = error?.response?.status;

            // A non-429 4xx means the request itself is bad (auth/schema) —
            // retrying won't help, so drop this sink for the batch.
            if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
                froggerInternal.warn(`Client transport "${transport.name}" rejected the batch (${status}). Dropping.`);
                return;
            }

            const maxRetries = transport.maxRetries ?? 3;
            if (attempt >= maxRetries) {
                froggerInternal.warn(`Client transport "${transport.name}" failed after ${maxRetries} retries. Dropping batch.`);
                return;
            }

            const retryAfterMs = this.parseRetryAfterMs(error);
            const baseDelay = transport.retryDelay ?? 1000;
            const backoff = Math.min(baseDelay * Math.pow(2, attempt), this.maxBackoffMs);
            const delay = retryAfterMs ?? backoff;

            await new Promise(resolve => setTimeout(resolve, delay));
            await this.sendChunkToClientTransport(transport, batch, attempt + 1);
        }
    }

    /** Parse a `Retry-After` header (seconds) from a fetch error into ms. */
    private parseRetryAfterMs(error: any): number | undefined {
        const header = error?.response?.headers?.get?.('retry-after');
        if (!header) return undefined;
        const seconds = Number(header);
        return Number.isFinite(seconds) ? seconds * 1000 : undefined;
    }

    private async sendLogImmediately(log: LoggerObject): Promise<void> {
        const primaryEligible = this.shouldSendToPrimary();

        if (!primaryEligible && this.clientTransports.length === 0) {
            return;
        }

        if (this.scrubber) {
            this.scrubber.scrubLoggerObject(log);
        }

        const batch: LoggerObjectBatch = {
            logs: [log],
            app: this.appInfo
        };

        // Fan out to secondary sinks independently of the primary.
        for (const transport of this.clientTransports) {
            void this.sendToClientTransport(transport, batch);
        }

        if (!primaryEligible) {
            return;
        }

        if (this.isRateLimited()) {
            froggerInternal.debug('Dropping immediate log due to rate limiting');
            return;
        }

        try {
            await $fetch(this.endpoint as string, {
                baseURL: this.baseUrl || undefined,
                method: 'POST',
                body: batch,
            });

            this.resetRetryState();
        }
        catch (error: any) {
            froggerInternal.error('Failed to send log immediately:', error);

            this.handleRateLimit(error);
        }
    }

    async flush(): Promise<void> {
        if (!this.batchingEnabled) {
            return;
        }

        if (this.queue.length > 0) {
            await this.sendLogs();
        }
    }
}