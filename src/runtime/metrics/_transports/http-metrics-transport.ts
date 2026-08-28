import { useFroggerConfig, useFroggerServerConfig } from '../../shared/utils/use-frogger-config'

import { parseAppInfoConfig } from '../../app-info/parse'
import { splitMetricBatch } from '../shared/utils/split-metric-batch'

import { BaseMetricsTransport } from './base-metrics-transport'
import type { MetricObject } from '../shared/types/metric'
import type { MetricObjectBatch } from '../shared/types/metric-batch'
import { METRIC_BATCH_SCHEMA } from '../shared/types/metric-batch'
import type { FroggerResource } from '../../shared/types/resource'

import { uuidv7 } from '../../shared/utils/uuid'
import { froggerInternal } from '../../shared/utils/internal-log'

export interface MetricsHttpTransportOptions {
    endpoint: string
    baseUrl?: string
    headers?: Record<string, string>
    /** Sent on every batch POST. Location is controlled by `apiKeyLocation`. */
    apiKey?: string
    /**
     * Where the API key is sent. `'header'` (default) → `x-api-key`; `'query'`
     * → `?key=` on the request URL (nuxt-observe's browser-facing contract).
     */
    apiKeyLocation?: 'header' | 'query'
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
    /** Split outgoing batches so no chunk exceeds this many events. 0 = no cap. */
    maxBatchEvents?: number
    /** Split outgoing batches so no chunk's JSON body exceeds this. 0 = no cap. */
    maxBodyBytes?: number
    appInfo?: {
        name: string
        version?: string
    }
}

/**
 * Transport that POSTs metric batches to an HTTP ingest endpoint - the metrics
 * sibling of the log `HttpTransport` (same retry/drop discipline: non-429 4xx
 * is a deterministic client error and drops immediately, everything else backs
 * off exponentially). Receives the bare `MetricObject[]` transport contract;
 * the device/session envelope survives because ingest denormalises it onto
 * each point, so the rebuilt wire batch needs `app` + fresh `meta` only.
 */
export class MetricsHttpTransport extends BaseMetricsTransport<Required<MetricsHttpTransportOptions>> {
    public readonly name = 'FroggerMetricsHttpTransport'
    public readonly transportId: string

    protected options: Required<MetricsHttpTransportOptions>
    private retries: Map<string, number> = new Map()
    private readonly resource: FroggerResource | undefined

    constructor(options: MetricsHttpTransportOptions) {
        super()
        this.transportId = `frogger-metrics-http-${uuidv7()}`

        const config = useFroggerConfig()
        const { isSet, name, version } = parseAppInfoConfig(config.app)
        this.resource = useFroggerServerConfig().resource ?? config.resource

        this.options = {
            endpoint: options.endpoint,
            baseUrl: options.baseUrl || config.baseUrl || '',
            appInfo: isSet
                ? { name: name || 'unknown', version }
                : { name: 'unknown', version: 'unknown' },
            headers: { ...options.headers },
            apiKey: options.apiKey || '',
            apiKeyLocation: options.apiKeyLocation || 'header',
            timeout: options.timeout || 30000,
            retryOnFailure: options.retryOnFailure ?? true,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            maxBatchEvents: options.maxBatchEvents || 0,
            maxBodyBytes: options.maxBodyBytes || 0,
        }

        if (!this.options.endpoint) {
            throw new Error('MetricsHttpTransport requires an endpoint')
        }
    }

    async metric(metricObj: MetricObject): Promise<void> {
        await this.metricBatch([metricObj])
    }

    override async metricBatch(metrics: MetricObject[]): Promise<void> {
        if (metrics.length === 0) return

        const batch: MetricObjectBatch = {
            metrics,
            app: this.options.appInfo,
            resource: this.resource,
            meta: {
                schema: METRIC_BATCH_SCHEMA,
                processed: true,
                processChain: [this.transportId],
                source: this.options.appInfo.name,
                time: Date.now(),
            },
        }

        await this.sendBatch(batch)
    }

    private async sendBatch(batch: MetricObjectBatch): Promise<void> {
        const chunks = (this.options.maxBatchEvents || this.options.maxBodyBytes)
            ? splitMetricBatch(batch, {
                maxEvents: this.options.maxBatchEvents || undefined,
                maxBytes: this.options.maxBodyBytes || undefined,
            })
            : [batch]

        for (const chunk of chunks) {
            await this.sendChunk(chunk)
        }
    }

    private async sendChunk(batch: MetricObjectBatch): Promise<void> {
        const batchId = `metric-batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

        try {
            await this.performHttpRequest(batch)
            this.retries.delete(batchId)
        }
        catch (error) {
            // A non-429 4xx is a deterministic client error (bad key/schema) -
            // retrying can't help, so drop immediately (logged once).
            if (this.isDropError(error)) {
                froggerInternal.warn(
                    `MetricsHttpTransport: destination rejected the batch (${this.statusOf(error)}). Dropping ${batch.metrics.length} metrics.`,
                )
                this.retries.delete(batchId)
                return
            }

            if (this.options.retryOnFailure) {
                await this.handleSendFailure(batchId, batch)
            }
            else {
                froggerInternal.error(
                    `MetricsHttpTransport: failed to send metrics (retries disabled). Dropping ${batch.metrics.length} metrics.`,
                    error,
                )
            }
        }
    }

    private statusOf(error: unknown): number | undefined {
        //@ts-ignore - FetchError shape
        return error?.response?.status ?? (error as { statusCode?: number })?.statusCode
    }

    /** A non-429 4xx means the request itself is bad - retrying won't help. */
    private isDropError(error: unknown): boolean {
        const status = this.statusOf(error)
        return typeof status === 'number' && status >= 400 && status < 500 && status !== 429
    }

    private async performHttpRequest(batch: MetricObjectBatch): Promise<void> {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

        try {
            const headers: Record<string, string> = { ...this.options.headers }
            if (this.options.apiKey && this.options.apiKeyLocation !== 'query') {
                headers['x-api-key'] = this.options.apiKey
            }

            await $fetch(this.options.endpoint, {
                baseURL: this.options.baseUrl || undefined,
                method: 'POST',
                headers,
                query: this.options.apiKeyLocation === 'query' && this.options.apiKey
                    ? { key: this.options.apiKey }
                    : undefined,
                body: batch,
                signal: controller.signal,
            })
        }
        finally {
            clearTimeout(timeoutId)
        }
    }

    private async handleSendFailure(batchId: string, batch: MetricObjectBatch): Promise<void> {
        const retryCount = this.retries.get(batchId) || 0

        if (retryCount >= this.options.maxRetries) {
            froggerInternal.error(
                `MetricsHttpTransport: maximum retry attempts (${this.options.maxRetries}) reached for batch ${batchId}. Dropping ${batch.metrics.length} metrics.`,
            )
            this.retries.delete(batchId)
            return
        }

        this.retries.set(batchId, retryCount + 1)

        const backoffDelay = this.options.retryDelay * Math.pow(2, retryCount)

        await new Promise(resolve => setTimeout(resolve, backoffDelay))

        try {
            await this.performHttpRequest(batch)
            this.retries.delete(batchId)
        }
        catch (error) {
            // A 4xx surfacing mid-retry is still a deterministic client error.
            if (this.isDropError(error)) {
                froggerInternal.warn(
                    `MetricsHttpTransport: destination rejected the batch (${this.statusOf(error)}). Dropping ${batch.metrics.length} metrics.`,
                )
                this.retries.delete(batchId)
                return
            }
            await this.handleSendFailure(batchId, batch)
        }
    }

    override async destroy(): Promise<void> {
        this.retries.clear()
    }

    setAppInfo(name: string, version: string): void {
        this.options.appInfo = { name, version }
    }
}
