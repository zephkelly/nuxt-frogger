import { uuidv7 } from '../../shared/utils/uuid'

import { BaseMetricsTransport } from './base-metrics-transport'
import type { MetricObject } from '../shared/types/metric'



/**
 * Process-global registry of captured-metric arrays, keyed by transport `name`.
 * The metrics analogue of the log memory store — a separate registry on
 * `globalThis.__FROGGER_METRICS_STORE__` so metric and log captures never mix.
 * A `memoryMetricTransport({ name })` entry travels through `runtimeConfig`
 * carrying only its `name`; the constructed transport writes into
 * `STORE.get(name)`, and the `nuxt-frogger/testing` metric helpers read the
 * same array back out via {@link getMetricsStore}.
 */
const STORE: Map<string, MetricObject[]> = (
    (globalThis as unknown as { __FROGGER_METRICS_STORE__?: Map<string, MetricObject[]> })
        .__FROGGER_METRICS_STORE__ ??= new Map<string, MetricObject[]>()
)

/** Get (creating if absent) the shared capture array for a named metric memory transport. */
export function getMetricsStore(name: string): MetricObject[] {
    let metrics = STORE.get(name)
    if (!metrics) {
        metrics = []
        STORE.set(name, metrics)
    }
    return metrics
}

/**
 * Clear a single named metrics store (in place, so existing references stay
 * valid), or every store when no name is given.
 */
export function clearMetricsStore(name?: string): void {
    if (name === undefined) {
        for (const metrics of STORE.values()) {
            metrics.length = 0
        }
        return
    }
    const metrics = STORE.get(name)
    if (metrics) {
        metrics.length = 0
    }
}

export interface MetricsMemoryTransportOptions {
    name?: string
}

/**
 * Captures every metric into an in-memory array instead of a real sink.
 * Server-only. Intended for tests.
 */
export class MetricsMemoryTransport extends BaseMetricsTransport<MetricsMemoryTransportOptions> {
    public readonly name = 'FroggerMetricsMemoryTransport'
    public readonly transportId: string

    protected options: MetricsMemoryTransportOptions
    private metrics: MetricObject[]

    constructor(options: MetricsMemoryTransportOptions = {}) {
        super()
        this.transportId = `frogger-metrics-memory-${uuidv7()}`
        this.options = options

        this.metrics = options.name !== undefined
            ? getMetricsStore(options.name)
            : []
    }

    metric(metricObj: MetricObject): void {
        this.metrics.push(metricObj)
    }

    override metricBatch(metrics: MetricObject[]): void {
        for (const m of metrics) {
            this.metrics.push(m)
        }
    }

    override async flush(): Promise<void> { }

    getMetrics(): MetricObject[] {
        return this.metrics
    }

    clear(): void {
        this.metrics.length = 0
    }

    get size(): number {
        return this.metrics.length
    }
}
