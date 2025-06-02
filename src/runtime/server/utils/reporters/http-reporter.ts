import { H3Error } from "h3";

import { generateW3CTraceHeaders } from "./../../../shared/utils/trace-headers";

import type { IReporter } from "~/src/runtime/shared/types/internal-reporter";
import type { HttpReporterOptions } from "../../types/http-reporter";
import type { LoggerObject } from "~/src/runtime/shared/types/log";
import type { LoggerObjectBatch } from "~/src/runtime/shared/types/batch";


export const defaultHttpReporterOptions: HttpReporterOptions = {
    endpoint: '',
    vendor: 'frogger',
    headers: {},
    timeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 1000,
    appInfo: {
        name: 'unknown',
        version: 'unknown'
    },
};



/**
 * HTTP Reporter that logs directly to an endpoint
 */
export class HttpReporter implements IReporter {
    public readonly name = 'FroggerHttpReporter';
    private reporterId: string;
    
    private options: Required<HttpReporterOptions>;
    private retries: Map<string, number> = new Map();

    constructor(options: HttpReporterOptions) {
        this.reporterId = `frogger-http-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        this.options = {
            endpoint: options.endpoint,
            vendor: options.vendor || 'frogger',
            appInfo: {
                name: 'unknown',
                version: 'unknown',
                ...options.appInfo
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
                processChain: [this.reporterId],
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
            console.error(`HttpReporter failed to send batch ${batchId}:`, error);
            
            if (this.options.retryOnFailure) {
                await this.handleSendFailure(batchId, batch);
            }
            else {
                console.error(`HttpReporter dropped ${batch.logs.length} logs due to send failure`);
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
            vendorData: { frogger: this.reporterId }
        });
        
        return {
            'Content-Type': 'application/json',
            // Loop prevention headers
            'X-Frogger-Reporter-Id': this.reporterId,
            'X-Frogger-Processed': 'true',
            'X-Frogger-Source': this.options.appInfo.name,
            // W3C Trace headers
            traceparent: w3cHeaders.traceparent,
            ...(w3cHeaders.tracestate && { tracestate: w3cHeaders.tracestate }),
        };
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
                    '%cFROGGER', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    `🐸 [ERROR] http reporter failed to send logs`
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
        
        console.warn(`HttpReporter: Retrying batch ${batchId} in ${backoffDelay}ms (attempt ${retryCount + 1}/${this.options.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        
        try {
            await this.performHttpRequest(batch);
            this.retries.delete(batchId);
        }
        catch (error) {
            console.error(`HttpReporter: Retry ${retryCount + 1} for batch ${batchId} failed:`, error);
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