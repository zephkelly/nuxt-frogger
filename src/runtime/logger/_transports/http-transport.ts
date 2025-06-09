import { H3Error } from "h3";
import { useRuntimeConfig } from '#imports';
import { parseAppInfoConfig } from "../../app-info/parse";

import { generateW3CTraceHeaders } from "../../shared/utils/trace-headers";

import type { IFroggerTransport } from "./types";
import type { LoggerObject } from "~/src/runtime/shared/types/log";
import type { LoggerObjectBatch } from "~/src/runtime/shared/types/batch";

import { uuidv7 } from '../../shared/utils/uuid';



export interface HttpTransportOptions {
    endpoint: string;
    vendor?: string;
    headers?: Record<string, string>;
    timeout?: number;
    retryOnFailure?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    appInfo?: {
        name: string;
        version?: string;
    };
}

export const defaultHttpTransportOptions: HttpTransportOptions = {
    endpoint: '',
    vendor: 'frogger',
    headers: {},
    timeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 1000,
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

    constructor(options: HttpTransportOptions) {
        this.transportId = `frogger-http-${uuidv7()}`;

        const config = useRuntimeConfig()
        const { isSet, name, version } = parseAppInfoConfig(config.public.frogger.app);

        this.options = {
            endpoint: options.endpoint,
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
            timeout: options.timeout || 30000,
            retryOnFailure: options.retryOnFailure ?? true,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000
        };

        if (!this.options.endpoint) {
            throw new Error('HttpReporter requires an endpoint');
        }
    }

    async log(logObj: LoggerObject): Promise<void> {
        const batch: LoggerObjectBatch = {
            logs: [logObj],
            app: this.options.appInfo
        };

        await this.sendBatch(batch);
    }

    private addBatchMetadata(logBatch: LoggerObjectBatch): LoggerObjectBatch {
        return {
            ...logBatch,
            meta: {
                processed: true,
                processChain: [this.transportId],
                source: this.options.appInfo.name,
                time: Date.now()
            }
        };
    }

    async logBatch(logs: LoggerObject[]): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        const batch: LoggerObjectBatch = {
            logs,
            app: this.options.appInfo
        };

        const metadataBatch = this.addBatchMetadata(batch);
        await this.sendBatch(metadataBatch);
    }

    private async sendBatch(batch: LoggerObjectBatch): Promise<void> {
        const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        try {
            await this.performHttpRequest(batch); 
            this.retries.delete(batchId); 
        }
        catch (error) {
            if (this.options.retryOnFailure) {
                await this.handleSendFailure(batchId, batch);
            }
            else {
                throw error;
            }
        }
    }
    

    private createRequestHeaders(batch: LoggerObjectBatch): Record<string, string> {
        const firstLog = batch.logs[0];
        const traceContext = firstLog?.trace;

        const w3cHeaders = generateW3CTraceHeaders({
            traceId: traceContext?.traceId,
            parentSpanId: traceContext?.spanId,
            vendorData: { frogger: this.transportId }
        });

        const headers: Headers = new Headers({
            'x-frogger-reporter-id': this.transportId,
            'x-frogger-processed': 'true',

            'traceparent': w3cHeaders.traceparent,
            ...(w3cHeaders.tracestate && { tracestate: w3cHeaders.tracestate })
        });

        if (this.options.appInfo) {
            headers.set('x-frogger-source', this.options.appInfo.name);
        }
        
        return Object.fromEntries(headers.entries());
    }

    private async performHttpRequest(batch: LoggerObjectBatch): Promise<void> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        try {
            const headers = this.createRequestHeaders(batch);

            await $fetch(this.options.endpoint, {
                method: 'POST',
                headers: headers,
                body: batch,
                signal: controller.signal
            });
        }
        catch(error) {
            if (error instanceof H3Error) {
                console.log(
                    '%cFROGGER ERROR', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    `🐸 http reporter failed to send logs`
                );
            }
        }
        finally {
            clearTimeout(timeoutId);
        }
    }

    private async handleSendFailure(batchId: string, batch: LoggerObjectBatch): Promise<void> {
        const retryCount = this.retries.get(batchId) || 0;
        
        if (retryCount >= this.options.maxRetries) {
            console.error(`HttpReporter: Maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${batch.logs.length} logs.`);
            this.retries.delete(batchId);
            throw new Error(`Max retries exceeded for batch ${batchId}`);
        }
        
        this.retries.set(batchId, retryCount + 1);
        
        const backoffDelay = this.options.retryDelay * Math.pow(2, retryCount);
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        
        try {
            await this.performHttpRequest(batch);
            this.retries.delete(batchId);
        }
        catch (error) {
            await this.handleSendFailure(batchId, batch);
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