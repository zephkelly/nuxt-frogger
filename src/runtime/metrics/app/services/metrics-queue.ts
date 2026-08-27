import { useRuntimeConfig } from '#imports'

import type { MetricObject } from '../../shared/types/metric'
import type { MetricObjectBatch, MetricContext } from '../../shared/types/metric-batch'
import type { ResolvedMetricClientTransport } from '../../shared/types/metric-transports'
import type { BatchOptions } from '../../../shared/types/batch'

import { parseAppInfoConfig } from '../../../app-info/parse'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { splitMetricBatch } from '../../shared/utils/split-metric-batch'

/**
 * Client metrics queue. Structurally parallel to `LogQueueService` (timer
 * batching, bounded retry/backoff, `flush()`, secondary client-transport
 * fan-out) but on the metrics body contract and with two metrics-specific
 * concerns folded in:
 *
 *  - a per-session sampling decision - an unsampled session enqueues nothing,
 *  - a per-pageload `maxEventsPerPage` hard cap - drop + one internal warning.
 *
 * The page-exit exit contract is a plain JSON string beaconed to the ingest
 * route and any client transports (see {@link flush}); `$fetch` is used for
 * in-session sends.
 */

// The ~64KB sendBeacon quota is CUMULATIVE across in-flight beacons, not
// per-call: chunks 2..n of a split flush (and the keepalive fallback) draw on
// the same budget, so each chunk stays well under it.
const BEACON_MAX_BYTES = 16 * 1024

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

    /** Secondary sinks (observe direct-from-browser). Never touch primary state. */
    private readonly clientTransports: ResolvedMetricClientTransport[]

    private appInfo: { name?: string; version?: string } | undefined
    private context: MetricContext | undefined
    private session: { id: string; sampled: boolean } | undefined

    private retryCount: number = 0
    private nextRetryAt: number = 0

    constructor() {
        const config = useRuntimeConfig()
        //@ts-ignore - public.frogger.metrics is injected only when metrics are on
        const metricsConfig = (config.public?.frogger?.metrics ?? {}) as {
            endpoint?: string | false
            batch?: BatchOptions | false
            maxEventsPerPage?: number
            transports?: ResolvedMetricClientTransport[]
        }

        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config.public?.frogger?.app)
        this.appInfo = isSet ? { name, version } : { name: 'unknown', version: 'unknown' }

        this.endpoint = metricsConfig.endpoint ?? false
        //@ts-ignore
        this.baseUrl = config.public?.frogger?.baseUrl || ''

        // Mirrors DEFAULT_MAX_EVENTS_PER_PAGE; not imported because pulling
        // resolve-metrics into the client bundle drags resolve-options along.
        this.maxEventsPerPage = metricsConfig.maxEventsPerPage ?? 500

        this.clientTransports = metricsConfig.transports ?? []

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

    /** The app's own ingest route is usable (not disabled). */
    private hasPrimary(): boolean {
        return this.endpoint !== false && !!this.endpoint
    }

    enqueueMetric(metric: MetricObject): void {
        if (!this.isSampled()) return

        if (this.eventsThisPage >= this.maxEventsPerPage) {
            if (!this.capWarned) {
                this.capWarned = true
                froggerInternal.warn(
                    `Metrics per-page cap of ${this.maxEventsPerPage} reached - further metrics this page load are dropped.`,
                )
            }
            return
        }
        this.eventsThisPage++

        if (!this.batchingEnabled) {
            void this.send([metric]).catch(() => {
                // Unbatched sends have no retry queue; best-effort only.
            })
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

    /**
     * In-session send. Builds the envelope batch once, fans it out to any
     * secondary client transports (their failures never touch the primary
     * retry state), then POSTs to the primary ingest route via `$fetch`
     * (application/json, `keepalive` so an in-flight send survives page hide).
     * Only a primary failure throws - that is what the caller's retry
     * machinery is for.
     */
    private async send(metrics: MetricObject[]): Promise<void> {
        if (metrics.length === 0) return

        const primaryEligible = this.hasPrimary()
        if (!primaryEligible && this.clientTransports.length === 0) return

        const batch = this.buildBatch(metrics)

        for (const transport of this.clientTransports) {
            this.sendToClientTransport(transport, batch)
        }

        if (!primaryEligible) return

        await $fetch(this.endpoint as string, {
            baseURL: this.baseUrl || undefined,
            method: 'POST',
            body: batch,
            // The browser aborts plain fetches on unload; keepalive lets an
            // in-flight in-session send finish after page hide.
            keepalive: true,
        })
    }

    /**
     * Fan a batch out to one secondary client transport. When the transport
     * declares batch caps (observe: 500 events / ~950 KiB), the batch is split
     * first and each chunk is delivered with its own independent retry.
     */
    private sendToClientTransport(
        transport: ResolvedMetricClientTransport,
        batch: MetricObjectBatch,
    ): void {
        const chunks = (transport.maxBatchEvents || transport.maxBodyBytes)
            ? splitMetricBatch(batch, {
                maxEvents: transport.maxBatchEvents,
                maxBytes: transport.maxBodyBytes,
            })
            : [batch]

        for (const chunk of chunks) {
            // The splitter strips `meta`; restamp so the destination's loop /
            // staleness checks run on fanned-out traffic too.
            chunk.meta ??= {
                time: Date.now(),
                processChain: this.appInfo?.name ? [this.appInfo.name] : [],
            }
            void this.sendChunkToClientTransport(transport, chunk)
        }
    }

    /**
     * Send one chunk to a secondary client transport with independent, bounded
     * retry. Respects `Retry-After`/`429` with exponential backoff; a `4xx`
     * (bad key/schema) drops the chunk and stops retrying that sink. Never
     * re-queues onto the shared primary queue or mutates the primary retry
     * state.
     *
     * Auth follows `apiKeyLocation`: `'query'` sends a bare `$fetch` with
     * `?key=` and no `x-api-key` header (what observe's CORS design expects);
     * `'header'` (default) sends `x-api-key`.
     */
    private async sendChunkToClientTransport(
        transport: ResolvedMetricClientTransport,
        batch: MetricObjectBatch,
        attempt = 0,
    ): Promise<void> {
        const url = transport.endpoint || transport.baseUrl
        if (!url) return

        const queryAuth = transport.apiKeyLocation === 'query'

        const headers: Record<string, string> = {
            ...transport.headers,
            ...(transport.apiKey && !queryAuth ? { 'x-api-key': transport.apiKey } : {}),
        }

        try {
            await $fetch(url, {
                baseURL: transport.baseUrl || undefined,
                method: 'POST',
                headers,
                query: queryAuth && transport.apiKey ? { key: transport.apiKey } : undefined,
                body: batch,
                keepalive: true,
            })
        }
        catch (error: any) {
            const status = error?.response?.status

            if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
                froggerInternal.warn(`Metric client transport "${transport.name}" rejected the batch (${status}). Dropping.`)
                return
            }

            const maxRetries = transport.maxRetries ?? MAX_RETRIES
            if (attempt >= maxRetries) {
                froggerInternal.warn(`Metric client transport "${transport.name}" failed after ${maxRetries} retries. Dropping batch.`)
                return
            }

            const retryAfterMs = this.parseRetryAfterMs(error)
            const baseDelay = transport.retryDelay ?? 1000
            const backoff = Math.min(baseDelay * Math.pow(2, attempt), MAX_BACKOFF_MS)

            await new Promise(resolve => setTimeout(resolve, retryAfterMs ?? backoff))
            await this.sendChunkToClientTransport(transport, batch, attempt + 1)
        }
    }

    /** Parse a `Retry-After` header (seconds) from a fetch error into ms. */
    private parseRetryAfterMs(error: any): number | undefined {
        const header = error?.response?.headers?.get?.('retry-after')
        if (!header) return undefined
        const seconds = Number(header)
        return Number.isFinite(seconds) ? seconds * 1000 : undefined
    }

    /**
     * Drain the queue on page exit. When `useBeacon` is set (the
     * `visibilitychange → hidden` / `pagehide` path) the batch is split under
     * the beacon quota and each chunk is sent as a plain JSON string via
     * `navigator.sendBeacon` - to the primary ingest route AND every client
     * transport (query auth appended to the URL; `sendBeacon` cannot set
     * headers) - falling back to `fetch(keepalive)` when a beacon is refused.
     * Otherwise a normal in-session send runs.
     */
    async flush(useBeacon: boolean = false): Promise<void> {
        if (!this.batchingEnabled || this.queue.length === 0) return

        const primaryEligible = this.hasPrimary()
        if (!primaryEligible && this.clientTransports.length === 0) {
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

        // ofetch joins baseURL/endpoint properly, but the beacon path builds
        // its URL by hand: strip a trailing slash so the default baseUrl `/`
        // yields `/api/...`, never the protocol-relative `//api/...`.
        const primaryUrl = this.baseUrl.replace(/\/$/, '') + (this.endpoint || '')
        const chunks = splitMetricBatch(this.buildBatch(metrics), { maxBytes: BEACON_MAX_BYTES })

        for (const chunk of chunks) {
            // Fresh meta per chunk (the splitter strips it) so ingest loop /
            // staleness detection runs on beacon traffic.
            chunk.meta = {
                time: Date.now(),
                processChain: this.appInfo?.name ? [this.appInfo.name] : [],
            }
            const body = JSON.stringify(chunk)

            if (primaryEligible) {
                this.exitSend(primaryUrl, body)
            }
            for (const transport of this.clientTransports) {
                this.exitSendToClientTransport(transport, body)
            }
        }
    }

    /** `sendBeacon` with a `fetch(keepalive)` fallback (refused/oversize beacon). */
    private exitSend(url: string, body: string, headers?: Record<string, string>): void {
        if (!headers && this.tryBeacon(url, body)) return

        try {
            void fetch(url, {
                method: 'POST',
                keepalive: true,
                headers: { 'content-type': 'application/json', ...headers },
                body,
            })
        }
        catch {
            // Nothing more to try on exit.
        }
    }

    /**
     * Exit-path delivery to one client transport. Query auth rides the URL
     * (`sendBeacon` cannot set headers, making query auth the only possible
     * beacon auth); a header-auth transport goes straight to `fetch(keepalive)`,
     * which can still carry `x-api-key`.
     */
    private exitSendToClientTransport(
        transport: ResolvedMetricClientTransport,
        body: string,
    ): void {
        let url = (transport.baseUrl || '') + (transport.endpoint || '')
        if (!url) return

        const queryAuth = transport.apiKeyLocation === 'query'
        if (queryAuth && transport.apiKey) {
            url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(transport.apiKey)
        }

        const headers = transport.apiKey && !queryAuth
            ? { ...transport.headers, 'x-api-key': transport.apiKey }
            : undefined

        this.exitSend(url, body, headers)
    }

    private tryBeacon(url: string, body: string): boolean {
        if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
            return false
        }
        try {
            return navigator.sendBeacon(url, body)
        }
        catch {
            return false
        }
    }
}
