import type { FileOptions } from '../../../shared/types/file'

/**
 * Declarative metric-transport destinations. A deliberately separate union
 * from the log `FroggerTransportConfig` — the two pipelines share no body
 * types and no transport list. v1 ships file + memory sinks only; the HTTP
 * metric transport (client + server fan-out) lands in Phase 2.
 */

/**
 * Persistent file logging of raw metric events (rotated JSON-lines). Server-only.
 * Defaults to a `logs/metrics/` directory, distinct from the log files.
 */
export interface MetricFileTransportConfig extends FileOptions {
    type: 'file'
    name?: string
}

/**
 * In-memory metric capture for tests. Server-only. A `name` shares its array
 * with the `nuxt-frogger/testing` metric helpers (`getCapturedMetrics`).
 */
export interface MetricMemoryTransportConfig {
    type: 'memory'
    name?: string
    /** Capture from the browser queue. Server-only for v1; ignored with a warning. */
    client?: boolean
    server?: boolean
}

/** Any declarative metric-transport entry, tagged by `type`. */
export type FroggerMetricTransportConfig =
    | MetricFileTransportConfig
    | MetricMemoryTransportConfig

/**
 * A single normalised metric file transport as emitted into
 * `runtimeConfig.frogger.metrics`. Server-only.
 */
export interface ResolvedMetricFileTransport {
    type: 'file'
    name: string
    options: Required<FileOptions>
}

/**
 * A single normalised metric memory transport. Server-only. Carries only the
 * registry `name`; the captured array lives in the process-global metrics
 * store keyed by that name.
 */
export interface ResolvedMetricMemoryTransport {
    type: 'memory'
    name: string
}

/** A server-bound metric transport is a file or memory destination (v1). */
export type ResolvedMetricServerTransport =
    | ResolvedMetricFileTransport
    | ResolvedMetricMemoryTransport

/**
 * Client-bound metric transports (HTTP fan-out) are a Phase 2 capability; the
 * alias exists so the resolved shape's split is stable now.
 */
export type ResolvedMetricClientTransport = never
