import { defu } from 'defu'

import { BaseMetricsTransport } from './base-metrics-transport'
import type { IFroggerMetricsTransport } from './types'
import type { MetricObject } from '../shared/types/metric'
import type { BatchOptions } from '../../shared/types/batch'

import { uuidv7 } from '../../shared/utils/uuid'
import { froggerInternal } from '../../shared/utils/internal-log'
import { DEFAULT_METRICS_BATCH } from '../shared/utils/resolve-metrics'



export interface MetricsBatchTransportOptions extends BatchOptions {
    downstreamTransporters?: IFroggerMetricsTransport[]
    onFlush?: (metrics: MetricObject[]) => Promise<void>
}

/**
 * Time/size-window batcher for metric events. A retyped sibling of the log
 * `BatchTransport`: same `insertSorted` (binary search on `time`), `maxAge`
 * timer and `maxSize` cutoff scheduling, fanning `metricBatch` downstream. No
 * aggregation happens here - the window only orders and groups raw deltas.
 */
export class MetricsBatchTransport extends BaseMetricsTransport<Required<MetricsBatchTransportOptions>> {
    public readonly name = 'FroggerMetricsBatchTransport'
    public readonly transportId: string

    private metrics: MetricObject[] = []
    private timer: ReturnType<typeof setTimeout> | null = null
    protected options: Required<MetricsBatchTransportOptions>
    private flushing: boolean = false
    private retries: Map<string, number> = new Map()
    private flushPromise: Promise<void> = Promise.resolve()

    constructor(options: MetricsBatchTransportOptions) {
        super()
        this.transportId = `frogger-metrics-batcher-${uuidv7()}`

        const defaultOptions: MetricsBatchTransportOptions = {
            downstreamTransporters: [],
            onFlush: async (metrics) => {
                if (this.options.downstreamTransporters.length === 0) {
                    return
                }
                const promises = this.options.downstreamTransporters.map(async (t) => {
                    try {
                        await t.metricBatch(metrics)
                    }
                    catch (err) {
                        froggerInternal.error(`Error in downstream metric transport ${t.name}:`, err)
                        throw err
                    }
                })
                await Promise.all(promises)
            },
        }

        this.options = defu(options, defaultOptions, DEFAULT_METRICS_BATCH) as Required<MetricsBatchTransportOptions>
    }

    metric(metricObj: MetricObject): void {
        this.addToBuffer([metricObj])
    }

    override metricBatch(metrics: MetricObject[]): void {
        if (metrics.length === 0) return
        this.addToBuffer(metrics)
    }

    private addToBuffer(metrics: MetricObject[]): void {
        for (const m of metrics) {
            this.insertSorted(m)
        }

        if (this.metrics.length >= this.options.maxSize) {
            this.handleMaxSizeReached()
            return
        }

        this.scheduleFlush()
    }

    private handleMaxSizeReached(): void {
        const now = Date.now()
        const cutoffTime = now - this.options.sortingWindowMs
        const toFlush = this.metrics.filter(m => m.time <= cutoffTime)

        if (toFlush.length > 0) {
            this.scheduleFlush(0)
        }
        else {
            const oldest = this.metrics[0]!
            const waitTime = Math.max(0, (oldest.time + this.options.sortingWindowMs) - now)
            this.scheduleFlush(waitTime)
        }
    }

    private insertSorted(metric: MetricObject): void {
        let left = 0
        let right = this.metrics.length

        while (left < right) {
            const mid = Math.floor((left + right) / 2)
            if (this.metrics[mid]!.time <= metric.time) {
                left = mid + 1
            }
            else {
                right = mid
            }
        }

        this.metrics.splice(left, 0, metric)
    }

    public addDownstreamTransporter(t: IFroggerMetricsTransport): void {
        this.options.downstreamTransporters.push(t)
    }

    public removeDownstreamTransporter(t: IFroggerMetricsTransport): void {
        this.options.downstreamTransporters = this.options.downstreamTransporters.filter(x => x !== t)
    }

    public getDownstreamTransporters(): IFroggerMetricsTransport[] {
        return this.options.downstreamTransporters
    }

    public clearDownstreamTransporters(): void {
        this.options.downstreamTransporters = []
    }

    private handleFlushFailure(batchId: string, metrics: MetricObject[]): void {
        const retryCount = this.retries.get(batchId) || 0

        if (retryCount >= this.options.maxRetries) {
            froggerInternal.error(`Maximum retry attempts (${this.options.maxRetries}) reached for metric batch ${batchId}. Dropping ${metrics.length} metrics.`)
            this.retries.delete(batchId)
            return
        }

        this.retries.set(batchId, retryCount + 1)
        const backoffDelay = this.options.retryDelay * Math.pow(2, retryCount)

        setTimeout(async () => {
            if (!this.retries.has(batchId)) return
            try {
                await this.options.onFlush(metrics)
                this.retries.delete(batchId)
            }
            catch (error) {
                froggerInternal.error(`Retry for metric batch ${batchId} failed:`, error)
                this.handleFlushFailure(batchId, metrics)
            }
        }, backoffDelay)
    }

    private scheduleFlush(delay: number = this.options.maxAge): void {
        if (this.flushing || (this.timer !== null && delay === this.options.maxAge)) {
            return
        }

        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }

        this.timer = setTimeout(() => {
            this.timer = null
            this.flushPromise = this.flushPromise.then(() => this.flush())
        }, delay)
    }

    override async flush(): Promise<void> {
        if (this.flushing) return

        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }

        if (this.metrics.length === 0) return

        this.flushing = true

        try {
            const cutoffTime = Date.now() - this.options.sortingWindowMs
            const toFlush = this.metrics.filter(m => m.time <= cutoffTime)

            if (toFlush.length === 0) {
                if (this.metrics.length > 0) {
                    this.scheduleFlush(this.options.sortingWindowMs)
                }
                return
            }

            this.metrics = this.metrics.filter(m => m.time > cutoffTime)

            const batchId = `metric-batch-${Date.now()}-${uuidv7()}`

            try {
                await this.options.onFlush(toFlush)
                this.retries.delete(batchId)
            }
            catch (error) {
                froggerInternal.error(`Failed to flush metrics (batch ${batchId}):`, error)
                if (this.options.retryOnFailure) {
                    this.handleFlushFailure(batchId, toFlush)
                }
                else {
                    froggerInternal.error(`Dropped ${toFlush.length} metrics due to flush failure`)
                }
            }
        }
        finally {
            this.flushing = false

            if (this.metrics.length > 0) {
                this.scheduleFlush(Math.min(this.options.maxAge, this.options.sortingWindowMs))
            }
        }
    }

    override async forceFlush(): Promise<void> {
        await this.flushPromise
        return this.flush()
    }

    /**
     * Shutdown drain: bypass the sorting window entirely and hand every
     * buffered metric downstream in one final flush. Ported from the log
     * `BatchTransport.drain()`.
     */
    async drain(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }

        await this.flushPromise.catch(() => { })

        if (this.metrics.length === 0) return

        const toDrain = this.metrics
        this.metrics = []

        try {
            await this.options.onFlush(toDrain)
        }
        catch (error) {
            froggerInternal.error(`Failed to drain ${toDrain.length} metrics:`, error)
        }
    }
}

export function createMetricsBatchTransport(
    downstreamTransporters: IFroggerMetricsTransport[],
    options: Omit<MetricsBatchTransportOptions, 'onFlush' | 'downstreamTransporters'> = {},
): MetricsBatchTransport {
    return new MetricsBatchTransport({
        ...options,
        downstreamTransporters,
    })
}
