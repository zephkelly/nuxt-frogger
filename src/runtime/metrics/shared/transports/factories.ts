import type { FileOptions } from '../../../shared/types/file'
import type {
    MetricFileTransportConfig,
    MetricMemoryTransportConfig,
    MetricObserveTransportConfig,
} from '../types/metric-transports'

/**
 * Declarative metric-transport factories. The metrics-pipeline counterpart of
 * `shared/transports/factories.ts` - same tagged-serializable-factory
 * discipline (pure module, no `#imports`, returns a plain `{ type, ...options }`
 * object that survives `structuredClone`), a deliberately different body
 * contract. Add these to `metrics.transports`, not the log `transports`.
 */

/**
 * Persistent file logging of raw metric events (rotated JSON-lines). Server-only.
 * Defaults to a `logs/metrics/` directory (distinct from the log files).
 *
 * ```ts
 * metrics: { transports: [metricFileTransport()] }
 * ```
 */
export function metricFileTransport(options: FileOptions & { name?: string } = {}): MetricFileTransportConfig {
    return { type: 'file', ...options }
}

/**
 * In-memory metric capture for tests. Server-only. A `name` shares its array
 * with the `nuxt-frogger/testing` helpers (`getCapturedMetrics({ name })`).
 *
 * ```ts
 * metrics: { transports: [metricMemoryTransport({ name: 'test' })] }
 * ```
 */
export function metricMemoryTransport(options: Omit<MetricMemoryTransportConfig, 'type'> = {}): MetricMemoryTransportConfig {
    return { type: 'memory', ...options }
}

/**
 * A nuxt-observe deployment's metrics ingest. Encodes the observe contract
 * (ingest path, auth placement, batch caps) - the metrics sibling of the log
 * `observeTransport`, same option names.
 *
 * ```ts
 * metrics: { transports: [metricObserveTransport({ url: 'https://observe.app.com', key })] }              // relay (server)
 * metrics: { transports: [metricObserveTransport({ url: 'https://observe.app.com', key, client: true })] } // browser-direct
 * ```
 */
export function metricObserveTransport(options: Omit<MetricObserveTransportConfig, 'type'>): MetricObserveTransportConfig {
    return { type: 'observe', ...options }
}
