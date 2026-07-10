import { useRuntimeConfig } from '#imports'

import type { IFroggerMetricsTransport } from '../../_transports/types'
import type { MetricObject } from '../../shared/types/metric'
import type { MetricObjectBatch } from '../../shared/types/metric-batch'
import type { ResolvedMetricServerTransport } from '../../shared/types/metric-transports'
import type { BatchOptions } from '../../../shared/types/batch'

import { MetricsFileTransport } from '../../_transports/file-metrics-transport'
import { MetricsMemoryTransport } from '../../_transports/memory-metrics-transport'
import { MetricsBatchTransport, createMetricsBatchTransport } from '../../_transports/batch-metrics-transport'
import { froggerInternal } from '../../../shared/utils/internal-log'

/**
 * Server-side metrics queue. The metrics analogue of `ServerLogQueueService` —
 * same `getInstance()` + `initialise()`-from-runtimeConfig singleton shape and
 * per-transport try/catch isolation — but it does NOT aggregate: raw metric
 * events fan out to the configured sinks unchanged (aggregation is a read-time
 * concern). No scrubber runs on metrics; their cardinality guard is the
 * labels-vs-attr split enforced at collection time.
 */
export class ServerMetricsQueueService {
    private static instance: ServerMetricsQueueService | null = null

    private batchTransporter?: MetricsBatchTransport
    private directTransporters: IFroggerMetricsTransport[] = []
    private downstreamTransporters: IFroggerMetricsTransport[] = []

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
        //@ts-ignore — frogger.metrics is injected by the module only when enabled
        const metricsConfig = config.frogger?.metrics as { batch?: BatchOptions | false } | undefined

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
        //@ts-ignore — frogger.metrics.transports is injected by the module
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

    public enqueueBatch(batch: MetricObjectBatch): void {
        if (!this.ensureInitialised()) return

        const metrics = batch.metrics
        if (!metrics || metrics.length === 0) return

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
