import { useRuntimeConfig } from '#imports'

import type { MetricObject } from '../../shared/types/metric'
import type { MetricObjectBatch, MetricContext } from '../../shared/types/metric-batch'
import type { BatchOptions } from '../../../shared/types/batch'

import { parseAppInfoConfig } from '../../../app-info/parse'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { splitMetricBatch } from '../../shared/utils/split-metric-batch'

/**
 * Client metrics queue. Structurally parallel to `LogQueueService` (timer
 * batching, bounded retry/backoff, `flush()`) but on the metrics body contract
 * and with two metrics-specific concerns folded in:
 *
 *  - a per-session sampling decision — an unsampled session enqueues nothing,
 *  - a per-pageload `maxEventsPerPage` hard cap — drop + one internal warning.
 *
 * The page-exit exit contract is a plain JSON string beaconed to the ingest
 * route (see {@link flush}); `$fetch` is used for in-session sends.
 */

// Keep beacon chunks comfortably under the ~64KB sendBeacon quota.
const BEACON_MAX_BYTES = 60 * 1024

const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 2000
const MAX_BACKOFF_MS = 60000

export class MetricsQueueService {
    private queue: MetricObject[] = []
    private timer: ReturnType<typeof setTimeout> | null = null
    private sending: boolean = false
    private batchingEnabled: boolean = true

    private endpoint: string | false
    private readonly baseUrl: string

    private maxBatchSize: number | undefined
    private maxBatchAge: number | undefined

    private readonly maxEventsPerPage: number
    private eventsThisPage: number = 0
    private capWarned: boolean = false

    private appInfo: { name?: string; version?: string } | undefined
    private context: MetricContext | undefined
    private session: { id: string; sampled: boolean } | undefined

    private retryCount: number = 0
    private nextRetryAt: number = 0

    constructor() {
        const config = useRuntimeConfig()
        //@ts-ignore — public.frogger.metrics is injected only when metrics are on
        const metricsConfig = (config.public?.frogger?.metrics ?? {}) as {
            endpoint?: string | false
            batch?: BatchOptions | false
            maxEventsPerPage?: number
        }

        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config.public?.frogger?.app)
        this.appInfo = isSet ? { name, version } : { name: 'unknown', version: 'unknown' }

        this.endpoint = metricsConfig.endpoint ?? '/api/_frogger/metrics'
        //@ts-ignore
        this.baseUrl = config.public?.frogger?.baseUrl || ''

        this.maxEventsPerPage = metricsConfig.maxEventsPerPage ?? 500

        this.batchingEnabled = metricsConfig.batch !== false
        if (this.batchingEnabled && metricsConfig.batch) {
            this.maxBatchSize = metricsConfig.batch.maxSize
            this.maxBatchAge = metricsConfig.batch.maxAge
        }
    }

    setAppInfo(name: string, version: string): void {
        this.appInfo = { name, version }
    }

    setContext(context: MetricContext | undefined): void {
        this.context = context
    }

    setSession(session: { id: string; sampled: boolean }): void {
        this.session = session
    }

    /** Whether this session collects at all (false ⇒ sampled out). */
    isSampled(): boolean {
        return this.session ? this.session.sampled : true
    }

    enqueueMetric(metric: MetricObject): void {
        if (!this.isSampled()) return

        if (this.eventsThisPage >= this.maxEventsPerPage) {
            if (!this.capWarned) {
                this.capWarned = true
                froggerInternal.warn(
                    `Metrics per-page cap of ${this.maxEventsPerPage} reached — further metrics this page load are dropped.`,
                )
            }
            return
        }
        this.eventsThisPage++

        if (!this.batchingEnabled) {
            void this.send([metric])
            return
        }

        this.queue.push(metric)
        this.scheduleSend()
    }

    private scheduleSend(): void {
        if (!this.batchingEnabled) return
        if (Date.now() < this.nextRetryAt) return

        if (this.maxBatchSize && this.queue.length >= this.maxBatchSize) {
            void this.sendQueued()
            return
        }

        if (this.timer !== null) return

        this.timer = setTimeout(() => {
            this.timer = null
            void this.sendQueued()
        }, this.maxBatchAge)
    }

    private buildBatch(metrics: MetricObject[]): MetricObjectBatch {
        return {
            metrics,
            app: this.appInfo,
            context: this.context,
            session: this.session,
            meta: {
                time: Date.now(),
                processChain: this.appInfo?.name ? [this.appInfo.name] : [],
            },
        }
    }

    private async sendQueued(): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0 || this.sending) return
        if (Date.now() < this.nextRetryAt) return

        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }

        this.sending = true
        const metrics = [...this.queue]
        this.queue = []

        try {
            await this.send(metrics)
            this.retryCount = 0
            this.nextRetryAt = 0
        }
        catch (error: any) {
            const status = error?.response?.status
            if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
                froggerInternal.warn(`Metrics ingest rejected the batch (${status}). Dropping.`)
                this.retryCount = 0
                return
            }

            this.retryCount++
            if (this.retryCount >= MAX_RETRIES) {
                froggerInternal.warn(`Metrics send failed after ${MAX_RETRIES} attempts. Dropping ${metrics.length} metrics.`)
                this.retryCount = 0
                return
            }

            const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, this.retryCount - 1), MAX_BACKOFF_MS)
            this.nextRetryAt = Date.now() + backoff
            this.queue = [...metrics, ...this.queue]
            setTimeout(() => {
                if (this.queue.length > 0) this.scheduleSend()
            }, backoff)
        }
        finally {
            this.sending = false
            if (this.queue.length > 0 && Date.now() >= this.nextRetryAt) {
                this.scheduleSend()
            }
        }
    }

    /** In-session send via `$fetch` (application/json). */
    private async send(metrics: MetricObject[]): Promise<void> {
        if (this.endpoint === false || !this.endpoint || metrics.length === 0) return

        await $fetch(this.endpoint as string, {
            baseURL: this.baseUrl || undefined,
            method: 'POST',
            body: this.buildBatch(metrics),
        })
    }

    /**
     * Drain the queue on page exit. When `useBeacon` is set (the
     * `visibilitychange → hidden` / `pagehide` path) the batch is split under
     * the beacon quota and each chunk is sent as a plain JSON string via
     * `navigator.sendBeacon`, falling back to `fetch(keepalive)` when a beacon
     * is refused (returns false / payload too big). Otherwise a normal in-session
     * send runs.
     */
    async flush(useBeacon: boolean = false): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0) return
        if (this.endpoint === false || !this.endpoint) {
            this.queue = []
            return
        }

        if (this.timer !== null) {
            clearTimeout(this.timer)
            this.timer = null
        }

        const metrics = [...this.queue]
        this.queue = []

        if (!useBeacon) {
            try {
                await this.send(metrics)
            }
            catch {
                // Best-effort in-session flush; page is not necessarily exiting.
            }
            return
        }

        const url = (this.baseUrl || '') + (this.endpoint as string)
        const chunks = splitMetricBatch(this.buildBatch(metrics), { maxBytes: BEACON_MAX_BYTES })

        for (const chunk of chunks) {
            const body = JSON.stringify(chunk)
            let delivered = false

            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                try {
                    delivered = navigator.sendBeacon(url, body)
                }
                catch {
                    delivered = false
                }
            }

            if (!delivered) {
                try {
                    void fetch(url, {
                        method: 'POST',
                        keepalive: true,
                        headers: { 'content-type': 'application/json' },
                        body,
                    })
                }
                catch {
                    // Nothing more to try on exit.
                }
            }
        }
    }
}
