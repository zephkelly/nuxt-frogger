import type { FileOptions } from '../../../shared/types/file'
import type {
    MetricFileTransportConfig,
    MetricMemoryTransportConfig,
} from '../types/metric-transports'

/**
 * Declarative metric-transport factories. The metrics-pipeline counterpart of
 * `shared/transports/factories.ts` — same tagged-serializable-factory
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
