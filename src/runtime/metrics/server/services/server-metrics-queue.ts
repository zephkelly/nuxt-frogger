import { useRuntimeConfig } from '#imports'

import type { IFroggerMetricsTransport } from '../../_transports/types'
import type { MetricObject } from '../../shared/types/metric'
import type { MetricObjectBatch } from '../../shared/types/metric-batch'
import type { ResolvedMetricServerTransport } from '../../shared/types/metric-transports'
import type { BatchOptions } from '../../../shared/types/batch'

import { MetricsFileTransport } from '../../_transports/file-metrics-transport'
import { MetricsMemoryTransport } from '../../_transports/memory-metrics-transport'
import { MetricsHttpTransport } from '../../_transports/http-metrics-transport'
import { MetricsBatchTransport, createMetricsBatchTransport } from '../../_transports/batch-metrics-transport'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { parseAppInfoConfig } from '../../../app-info/parse'
import { LogScrubber } from '../../../scrubber'
import { scrubMetricBatch } from '../../shared/utils/scrub-metric-batch'
import type { ScrubberOptions } from '../../../scrubber/options'

/**
 * Server-side metrics queue. The metrics analogue of `ServerLogQueueService` -
 * same `getInstance()` + `initialise()`-from-runtimeConfig singleton shape and
 * per-transport try/catch isolation - but it does NOT aggregate: raw metric
 * events fan out to the configured sinks unchanged (aggregation is a read-time
 * concern). Cardinality is guarded by the labels-vs-attr split enforced at
 * collection time; `labels`/`attr` content is scrubbed here, on the one hop
 * every point passes through, whether recorded locally or relayed.
 */
export class ServerMetricsQueueService {
    private static instance: ServerMetricsQueueService | null = null

    private batchTransporter?: MetricsBatchTransport
    private directTransporters: IFroggerMetricsTransport[] = []
    private downstreamTransporters: IFroggerMetricsTransport[] = []

    /** This server's own identity, stamped onto points it produces itself. */
    private appInfo: { name?: string, version?: string } | undefined

    private scrubber: LogScrubber | null = null

    private initialised: boolean = false

    private constructor() { }

    public static getInstance(): ServerMetricsQueueService {
        if (!ServerMetricsQueueService.instance) {
            ServerMetricsQueueService.instance = new ServerMetricsQueueService()
            ServerMetricsQueueService.instance.initialise()
        }
        return ServerMetricsQueueService.instance
    }

    public initialise(): void {
        if (this.initialised) return
        this.initialised = true

        const config = useRuntimeConfig()
        //@ts-ignore - frogger.metrics is injected by the module only when enabled
        const metricsConfig = config.frogger?.metrics as { batch?: BatchOptions | false } | undefined

        // Points this server records itself carry its own identity; a relayed
        // batch already carries the origin app's and is never re-stamped.
        const publicFrogger = (config.public as { frogger?: { app?: unknown } } | undefined)?.frogger
        const { isSet, name, version } = parseAppInfoConfig(publicFrogger?.app)
        this.appInfo = isSet ? { name, version } : undefined

        // Metrics share the log pipeline's ruleset; this is the only hop that
        // can redact `labels`/`attr` before they reach a transport as raw JSON.
        const scrubConfig = (config.frogger as { scrub?: ScrubberOptions | false } | undefined)?.scrub
        if (scrubConfig) {
            this.scrubber = new LogScrubber(scrubConfig)
        }

        const batchingEnabled = (metricsConfig?.batch ?? false) !== false

        const configuredTransports = this.buildConfiguredTransports(config)

        if (batchingEnabled) {
            this.downstreamTransporters.push(...configuredTransports)
            this.batchTransporter = createMetricsBatchTransport(
                this.downstreamTransporters,
                (metricsConfig?.batch || {}) as BatchOptions,
            )
        }
        else {
            this.directTransporters.push(...configuredTransports)
        }
    }

    private buildConfiguredTransports(config: ReturnType<typeof useRuntimeConfig>): IFroggerMetricsTransport[] {
        //@ts-ignore - frogger.metrics.transports is injected by the module
        const configured = (config.frogger?.metrics?.transports ?? []) as ResolvedMetricServerTransport[]

        const transporters: IFroggerMetricsTransport[] = []
        for (const t of configured) {
            try {
                if (t.type === 'file') {
                    transporters.push(new MetricsFileTransport(t.options))
                    continue
                }
                if (t.type === 'memory') {
                    transporters.push(new MetricsMemoryTransport({ name: t.name }))
                    continue
                }
                if (t.type === 'http') {
                    transporters.push(new MetricsHttpTransport({
                        baseUrl: t.baseUrl,
                        endpoint: t.endpoint,
                        apiKey: t.apiKey,
                        apiKeyLocation: t.apiKeyLocation,
                        headers: t.headers,
                        timeout: t.timeout,
                        retryOnFailure: t.retryOnFailure,
                        maxRetries: t.maxRetries,
                        retryDelay: t.retryDelay,
                        maxBatchEvents: t.maxBatchEvents,
                        maxBodyBytes: t.maxBodyBytes,
                    }))
                    continue
                }
                froggerInternal.warn(
                    `Unknown metric transport type "${(t as { type?: string }).type}" - skipping.`,
                )
            }
            catch (err) {
                froggerInternal.error('ServerMetricsQueueService: failed to construct metric transport', t.name, err)
            }
        }
        return transporters
    }

    private ensureInitialised(): boolean {
        if (!this.initialised) {
            this.initialise()
        }
        return true
    }

    /**
     * Record one point produced by this server. The single-point entry the
     * manual metrics API needs; `enqueueBatch` remains the relay path for
     * batches POSTed by a browser.
     */
    public enqueueMetric(metric: MetricObject): void {
        this.enqueueBatch({ metrics: [metric], app: this.appInfo })
    }

    public enqueueBatch(batch: MetricObjectBatch): void {
        if (!this.ensureInitialised()) return

        const metrics = batch.metrics
        if (!metrics || metrics.length === 0) return

        // Scrub before denormalising, so one pass covers the batch's shared
        // context rather than every copy of it.
        if (this.scrubber) {
            scrubMetricBatch(batch, this.scrubber)
        }

        // Transports receive a bare MetricObject[], so the batch envelope only
        // survives if it is denormalised onto each point first - the metrics
        // sibling of the log queue's origin-app stamping. `??=` keeps a relay
        // hop idempotent: a point stamped at the origin is never re-stamped.
        const app = batch.app
        for (const m of metrics) {
            if (app?.name) m.source ??= { name: app.name, version: app.version ?? '' }
            m.context ??= batch.context
            m.session ??= batch.session
            m.user ??= batch.user
        }

        if (this.batchTransporter) {
            try {
                this.batchTransporter.metricBatch(metrics)
            }
            catch (err) {
                froggerInternal.error('Error in metric batch transporter:', err)
            }
        }
        else {
            this.callDirectTransporters(metrics)
        }
    }

    public async flush(): Promise<void> {
        if (!this.initialised) return

        const flushPromises: Promise<void>[] = []

        if (this.batchTransporter) {
            if (this.batchTransporter.forceFlush) {
                flushPromises.push(this.batchTransporter.forceFlush().catch(err => {
                    froggerInternal.error('Error flushing metric batch transporter:', err)
                }))
            }
        }
        else {
            for (const t of this.directTransporters) {
                if (t.forceFlush) {
                    flushPromises.push(t.forceFlush().catch(err => {
                        froggerInternal.error(`Error flushing ${t.name}:`, err)
                    }))
                }
            }
        }

        await Promise.allSettled(flushPromises)
    }

    /**
     * Graceful-shutdown drain: force the batch window to hand everything to the
     * downstream sinks, then force-flush their own buffers (the file
     * transport's write buffer included). The metrics sibling of the log
     * queue's `drain()`.
     */
    public async drain(): Promise<void> {
        if (!this.initialised) return

        if (!this.batchTransporter) {
            await this.flush()
            return
        }

        try {
            await this.batchTransporter.drain()
        }
        catch (err) {
            froggerInternal.error('Error draining metric batch transporter:', err)
        }

        const downstreamFlushes = this.downstreamTransporters
            .filter(t => t.forceFlush)
            .map(t => t.forceFlush!().catch((err) => {
                froggerInternal.error(`Error flushing ${t.name} during drain:`, err)
            }))

        await Promise.allSettled(downstreamFlushes)
    }

    public async destroy(): Promise<void> {
        if (!this.initialised) return

        const destroyPromises: Promise<void>[] = []

        if (this.batchTransporter?.destroy) {
            destroyPromises.push(this.batchTransporter.destroy().catch(err => {
                froggerInternal.error('Error destroying metric batch transporter:', err)
            }))
        }

        for (const t of this.directTransporters) {
            if (t.destroy) {
                destroyPromises.push(t.destroy().catch(err => {
                    froggerInternal.error(`Error destroying ${t.name}:`, err)
                }))
            }
        }

        await Promise.allSettled(destroyPromises)

        this.batchTransporter = undefined
        this.directTransporters = []
        this.downstreamTransporters = []
        this.initialised = false
    }

    public addTransport(transport: IFroggerMetricsTransport): void {
        if (!this.ensureInitialised()) return
        if (this.batchTransporter) {
            this.batchTransporter.addDownstreamTransporter(transport)
        }
        else {
            this.directTransporters.push(transport)
        }
    }

    public getTransporterInfo(): {
        mode: 'batched' | 'direct'
        directTransporters: string[]
        downstreamTransporters?: string[]
    } {
        const info: {
            mode: 'batched' | 'direct'
            directTransporters: string[]
            downstreamTransporters?: string[]
        } = {
            mode: this.batchTransporter ? 'batched' : 'direct',
            directTransporters: this.directTransporters.map(t => t.name),
        }

        if (this.batchTransporter) {
            info.downstreamTransporters = this.batchTransporter.getDownstreamTransporters().map(t => t.name)
        }

        return info
    }

    private callDirectTransporters(metrics: MetricObject[]): void {
        for (const t of this.directTransporters) {
            try {
                t.metricBatch(metrics)
            }
            catch (err) {
                froggerInternal.error(`Error in direct metric transporter ${t.name}:`, err)
            }
        }
    }
}
