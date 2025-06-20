import { H3Error } from 'h3';

import type { LoggerObject } from '../../shared/types/log';
import type { LoggerObjectBatch } from '../../shared/types/batch';

import { useRuntimeConfig } from '#imports';
import { uuidv7 } from '../../shared/utils/uuid';

import { handleRateLimit } from '../../rate-limiter/utils/limit-handler';
import { SimpleConsoleLogger } from '../../logger/other/console-frogger';

import { parseAppInfoConfig } from '../../app-info/parse';
import { DEFAULT_LOGGING_ENDPOINT } from '../../shared/types/module-options';


interface RetryState {
    count: number;
    nextRetryAt: number;
    backoffMultiplier: number;
}

export class LogQueueService {
    private queue: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending: boolean = false;
    private batchingEnabled: boolean = true;
    private readonly serverModuleEnabled: boolean;
    private readonly reporterId: string;

    private endpoint: string;
    private readonly baseUrl: string;
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
        this.serverModuleEnabled = config.public.frogger.serverModule;
        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config.public.frogger.app);

        this.appInfo = isSet ? { name, version } : { name: 'unknown', version: 'unknown' };
        
        this.endpoint = config.public.frogger.endpoint;
        this.baseUrl = config.public.frogger.baseUrl || '';

        //@ts-expect-error
        this.batchingEnabled = config.public?.frogger?.batch !== false;

        if (!this.batchingEnabled) return;

        this.maxBatchSize = config.public.frogger.batch?.maxSize;
        this.maxBatchAge = config.public.frogger.batch?.maxAge;
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
            console.warn(`Log queue exceeded maximum size of ${this.maxQueueSize}. Old logs have been discarded.`);
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
            console.error(`Dropping ${this.queue.length} logs due to IP block`);
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
            console.error(`Max retries reached for rate limiting. Dropping ${this.queue.length} logs.`);
            this.queue = [];
            this.resetRetryState();
        }

        return true;
    }

    private handleGeneralError(error: any): void {
        this.retryState.count++;
        
        if (this.retryState.count >= this.maxRetries) {
            console.error(`Max retries (${this.maxRetries}) reached. Dropping ${this.queue.length} logs.`);
            this.queue = [];
            this.resetRetryState();
            return;
        }

        const backoffMs = Math.min(
            this.baseBackoffMs * Math.pow(2, this.retryState.count - 1),
            this.maxBackoffMs
        );

        this.retryState.nextRetryAt = Date.now() + backoffMs;

        console.warn(
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

    private async sendLogs(): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0 || this.sending) {
            return;
        }

        if (!this.serverModuleEnabled && this.endpoint === DEFAULT_LOGGING_ENDPOINT) {
            return;
        }

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
            if (!this.endpoint) {
                console.warn('No endpoint specified for sending logs');
                return;
            }
            
            const batch: LoggerObjectBatch = {
                logs,
                app: this.appInfo,
                meta: {
                    time: Date.now(),
                    processChain: this.appInfo?.name ? [this.appInfo.name] : [],
                }
            };

            const url = new URL(this.endpoint, this.baseUrl);
            
            await $fetch(url.toString(), {
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
                console.error(`Client error (${error.response.status}). Dropping logs to prevent retry loop.`);
                this.resetRetryState();
                return;
            }

            this.queue = [...logs, ...this.queue];
            if (this.maxQueueSize && this.queue.length > this.maxQueueSize) {
                const dropped = this.queue.length - this.maxQueueSize;
                this.queue = this.queue.slice(0, this.maxQueueSize);
                console.warn(`Dropped ${dropped} logs due to queue overflow during retry`);
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

    private async sendLogImmediately(log: LoggerObject): Promise<void> {
        if (!this.endpoint) return;

        if (!this.serverModuleEnabled && this.endpoint === DEFAULT_LOGGING_ENDPOINT) {
            return;
        }

        if (this.isRateLimited()) {
            console.debug('Dropping immediate log due to rate limiting');
            return;
        }

        const batch: LoggerObjectBatch = {
            logs: [log],
            app: this.appInfo
        };

        try {
            await $fetch.raw(this.endpoint, {
                method: 'POST',
                body: batch,
            });

            this.resetRetryState();
        }
        catch (error: any) {
            console.error('Failed to send log immediately:', error);
            
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