import { defu } from 'defu';
import { useRuntimeConfig } from '#imports';
import { useFroggerConfig } from '../../shared/utils/use-frogger-config';

import { BaseTransport } from './base-transport';
import type { BatchOptions } from '../../shared/types/batch';
import type { LoggerObject } from '../../shared/types/log';
import type { SpanObject } from '../../shared/types/span';
import type { IFroggerTransport } from './types';

import { uuidv7 } from '../../shared/utils/uuid';
import { froggerInternal } from '../../shared/utils/internal-log';
import { recordDelivered, recordDropped, recordEnqueued } from '../../shared/utils/health';
import { backoffDelay } from '../../shared/utils/backoff';



export interface BatchTransportOptions extends BatchOptions {
    downstreamTransporters?: IFroggerTransport[];

    levels?: number[];

    onFlush?: (logs: LoggerObject[]) => Promise<void>;

    addTransport?: (reporter: IFroggerTransport) => void;
    removeTransport?: (reporter: IFroggerTransport) => void;
    getTransporters?: () => IFroggerTransport[];
    clearTransporters?: () => void;

    getTransporterIds?: () => string[];

    /**
     * Completed spans to attach to the next flush. A getter rather than a
     * buffer of its own: the queue owns the span buffer, and duplicating it
     * here would mean two places that can disagree about what has been sent.
     */
    getPendingSpans?: () => SpanObject[];
}

/**
 * A flush where some downstreams succeeded and others did not.
 *
 * Carries the failed set so the retry re-delivers to those alone, rather than
 * re-sending to destinations that already stored the batch.
 */
export class PartialFlushError extends Error {
    constructor(public readonly failed: IFroggerTransport[]) {
        super(`${failed.length} downstream transport(s) failed: ${failed.map(t => t.name).join(', ')}`)
        this.name = 'PartialFlushError'
    }
}

/**
 * Transport that batches logs before passing them downstream
 */
export class BatchTransport extends BaseTransport<Required<BatchTransportOptions>> {
    public readonly name = 'FroggerBatchReporter';
    public readonly transportId: string;

    private logs: LoggerObject[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    protected options: Required<BatchTransportOptions>;
    private lastFlushTime: number = 0;
    private flushing: boolean = false;
    private retries: Map<string, number> = new Map();
    private flushPromise: Promise<void> = Promise.resolve();

    constructor(options: BatchTransportOptions) {
        super();
        this.transportId = `frogger-batcher-${uuidv7()}`;

        const config = useFroggerConfig()

        const defaultOptions: BatchTransportOptions = {
            downstreamTransporters: [],
            onFlush: async (logs) => {
                if (this.options.downstreamTransporters.length === 0) {
                    return;
                }
                
                // Spans ride the same flush as the logs they bracket, so a
                // reader sees a span and its rows in one envelope.
                const spans = this.options.getPendingSpans?.() ?? [];

                const promises = this.options.downstreamTransporters.map(async (reporter) => {
                    try {
                        await reporter.logBatch(logs, spans);
                    }
                    catch (err) {
                        froggerInternal.error(`Error in downstream reporter ${reporter.name}:`, err);
                        throw err;
                    }
                });
                
                await Promise.all(promises);
            }
        };
        
        this.options = defu(options, defaultOptions, config.batch) as Required<BatchTransportOptions>;
    }
    
    log(logObj: LoggerObject): void {
        const processedLogs = this.processLogs([logObj]);
        if (processedLogs.length === 0) return;
        this.addLogsToBuffer(processedLogs);
    }

    override logBatch(logs: LoggerObject[]): void {
        if (logs.length === 0) {
            return;
        }

        const processedLogs = this.processLogs(logs);
        if (processedLogs.length === 0) {
            froggerInternal.debug('All logs in batch were filtered out');
            return;
        }
        
        this.addLogsToBuffer(processedLogs);
    }

    private processLogs(logs: LoggerObject[]): LoggerObject[] {
        const processedLogs: LoggerObject[] = [];
        
        for (const log of logs) {
            if (this.options.levels && this.options.levels.length > 0) {

                if (!this.options.levels.includes(log.lvl)) {
                    continue;
                }
            }

            processedLogs.push(log);
        }

        return processedLogs;
    }

    private addLogsToBuffer(logs: LoggerObject[]): void {
        for (const log of logs) {
            this.insertSorted(log);
        }

        recordEnqueued(logs.length);
        this.enforceQueueCeiling();

        if (this.logs.length >= this.options.maxSize) {
            this.handleMaxSizeReached();
            return;
        }
        
        this.scheduleFlush();
    }

    private handleMaxSizeReached(): void {
        const now = Date.now();
        const cutoffTime = now - this.options.sortingWindowMs;
        const logsToFlush = this.logs.filter(log => log.time <= cutoffTime);
        
        if (logsToFlush.length > 0) {
            this.scheduleFlush(0);
        }
        else {
            const oldestLog = this.logs[0]!;
            const waitTime = Math.max(0, (oldestLog.time + this.options.sortingWindowMs) - now);
            this.scheduleFlush(waitTime);
        }
    }

    /**
     * Shed load rather than growing without bound.
     *
     * `maxSize` only ever SCHEDULED a flush - nothing discarded - so a dead
     * downstream grew this buffer until the process died, taking the host
     * application with it. Oldest-first, matching the client queue, so the two
     * overflow paths agree on one documented policy.
     */
    private enforceQueueCeiling(): void {
        const ceiling = this.options.maxQueueSize;
        if (!ceiling || this.logs.length <= ceiling) return;

        const overflow = this.logs.length - ceiling;
        this.logs.splice(0, overflow);

        recordDropped('overflow', overflow, `batch buffer exceeded maxQueueSize (${ceiling})`);
    }

    private insertSorted(log: LoggerObject): void {
        let left = 0;
        let right = this.logs.length;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.logs[mid]!.time <= log.time) {
                left = mid + 1;
            }
            else {
                right = mid;
            }
        }
        
        this.logs.splice(left, 0, log);
    }



    // Downstream transporters ------------------------------------------------
    public addDownstreamTransporter(reporter: IFroggerTransport): void {
        this.options.downstreamTransporters.push(reporter);
    }

    public removeDownstreamTransporter(reporter: IFroggerTransport): void {
        this.options.downstreamTransporters = this.options.downstreamTransporters.filter(r => r !== reporter);
    }

    public getDownstreamTransporters(): IFroggerTransport[] {
        return this.options.downstreamTransporters;
    }

    public clearDownstreamTransporters(): void {
        this.options.downstreamTransporters = [];
    }

    // Flush handling ------------------------------------------------------
    private handleFlushFailure(batchId: string, logs: LoggerObject[], error?: unknown): void {
        const retryCount = this.retries.get(batchId) || 0;

        // When the failure names its failed downstreams, retry only those.
        const failedOnly = error instanceof PartialFlushError ? error.failed : undefined;

        if (retryCount >= this.options.maxRetries) {
            froggerInternal.error(`Maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${logs.length} logs.`);
            this.retries.delete(batchId);
            recordDropped('retriesExhausted', logs.length, `batch ${batchId} exhausted ${this.options.maxRetries} retries`);
            return;
        }

        // Each in-flight retry pins its whole batch in a setTimeout closure.
        // Without a ceiling, a sink that never recovers accumulates them until
        // the process dies - the same unbounded growth the buffer ceiling
        // above exists to prevent, just one level up.
        const maxConcurrent = this.options.maxConcurrentRetries;
        if (maxConcurrent && this.retries.size >= maxConcurrent && !this.retries.has(batchId)) {
            const oldest = this.retries.keys().next().value;
            if (oldest !== undefined) {
                this.retries.delete(oldest);
                recordDropped('overflow', 0, `abandoned retry for batch ${oldest}: too many concurrent retries`);
            }
        }

        this.retries.set(batchId, retryCount + 1);
        
        const delay = backoffDelay(retryCount, { baseMs: this.options.retryDelay });

        froggerInternal.warn(`Scheduling retry #${retryCount + 1} for batch ${batchId} in ${delay}ms`);
        
        setTimeout(async () => {
        if (!this.retries.has(batchId)) {
            return;
        }

        try {
            // Re-deliver to the failed subset only. Anything that already
            // stored this batch must not receive it twice.
            await this.retryFailedOnly(logs, failedOnly);
            froggerInternal.debug(`Retry #${retryCount + 1} for batch ${batchId} succeeded`);
            this.retries.delete(batchId);
        }
        catch (error) {
            froggerInternal.error(`Retry #${retryCount + 1} for batch ${batchId} failed:`, error);
            this.handleFlushFailure(batchId, logs, error);
        }
        }, delay);
    }

    /**
     * Deliver a batch to a specific subset of downstreams, or through the
     * configured `onFlush` when the failure did not name any (a custom
     * `onFlush`, which owns its own fan-out).
     */
    private async retryFailedOnly(logs: LoggerObject[], failed: IFroggerTransport[] | undefined): Promise<void> {
        if (!failed) {
            await this.options.onFlush(logs);
            return;
        }

        const results = await Promise.allSettled(failed.map(t => t.logBatch(logs)));
        const stillFailing = failed.filter((_, i) => results[i]?.status === 'rejected');

        if (stillFailing.length > 0) {
            throw new PartialFlushError(stillFailing);
        }
    }

    private scheduleFlush(delay: number = this.options.maxAge): void {
        if (this.flushing || (this.timer !== null && delay === this.options.maxAge)) {
            return;
        }
        
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flushPromise = this.flushPromise.then(() => this.flush());
        }, delay);
    }
    
    override async flush(): Promise<void> {
        if (this.flushing) {
            return;
        }
        
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        
        if (this.logs.length === 0) {
            return;
        }
        
        this.flushing = true;
        
        try {
            const cutoffTime = Date.now() - this.options.sortingWindowMs;
            const logsToFlush = this.logs.filter(log => log.time <= cutoffTime);
            
            if (logsToFlush.length === 0) {
                if (this.logs.length > 0) {
                    this.scheduleFlush(this.options.sortingWindowMs);
                }
                return;
            }
            
            this.logs = this.logs.filter(log => log.time > cutoffTime);
            
            const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            try {
                await this.options.onFlush(logsToFlush);
                recordDelivered(logsToFlush.length);
                this.retries.delete(batchId);
                this.lastFlushTime = Date.now();
            }
            catch (error) {
                froggerInternal.error(`Failed to flush logs (batch ${batchId}):`, error);
                
                if (this.options.retryOnFailure) {
                    this.handleFlushFailure(batchId, logsToFlush, error);
                }
                else {
                    froggerInternal.error(`Dropped ${logsToFlush.length} logs due to flush failure`);
                    recordDropped('retriesExhausted', logsToFlush.length, 'retries disabled on the batch transport');
                }
            }
        }
        finally {
            this.flushing = false;
            
            if (this.logs.length > 0) {
                this.scheduleFlush(Math.min(this.options.maxAge, this.options.sortingWindowMs));
            }
        }
    }
  
    override async forceFlush(): Promise<void> {
        await this.flushPromise;
        return this.flush();
    }

    /**
     * Flush EVERYTHING in the buffer, ignoring the sorting window. flush()
     * deliberately holds back logs younger than `sortingWindowMs` so late
     * arrivals sort correctly, but on a shutdown or crash path "wait for
     * stragglers" means "lose the batch". Logs are taken out of the buffer
     * before sending, so a concurrent scheduled flush can never double-send.
     */
    async drain(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        await this.flushPromise.catch(() => {});

        if (this.logs.length === 0) {
            return;
        }

        const logsToDrain = this.logs;
        this.logs = [];

        try {
            await this.options.onFlush(logsToDrain);
            this.lastFlushTime = Date.now();
        }
        catch (error) {
            froggerInternal.error(`Failed to drain ${logsToDrain.length} logs:`, error);
        }
    }
}

export function createBatchTransport(
    downstreamTransporters: IFroggerTransport[], 
    options: Omit<BatchTransportOptions, 'onFlush' | 'downstreamTransporters' | 'addDownstreamReporter' | 'removeDownstreamReporter' | 'getDownstreamReporters'> = {}
): BatchTransport {
    return new BatchTransport({
        ...options,
        downstreamTransporters
    });
}