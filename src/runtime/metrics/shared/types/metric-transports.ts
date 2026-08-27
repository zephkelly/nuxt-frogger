import type { FileOptions } from '../../../shared/types/file'

/**
 * Declarative metric-transport destinations. A deliberately separate union
 * from the log `FroggerTransportConfig` - the two pipelines share no body
 * types and no transport list. v1 shipped file + memory sinks; the observe
 * HTTP transport (server relay + browser-direct fan-out) is first-class.
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

/**
 * Declarative destination for a nuxt-observe deployment's METRICS ingest.
 * Encodes the observe contract (ingest path, header-vs-query auth, batch caps)
 * so a single `metricObserveTransport({ url, key })` entry is enough to ship
 * metrics there. The metrics sibling of the log `ObserveTransportConfig`.
 */
export interface MetricObserveTransportConfig {
    type: 'observe'
    /** Observe deployment origin, e.g. `https://observe.app.com`. */
    url: string
    /** Ingest API key. Sent as `x-api-key` (server) or `?key=` (browser). */
    key: string
    /**
     * Fan out directly from the browser metrics queue. The key becomes
     * bundle-visible; observe write keys are public by design, so no build
     * warning is emitted.
     *
     * @default false
     */
    client?: boolean
    /**
     * Relay from the Nitro server metrics queue.
     *
     * @default true
     */
    server?: boolean
    name?: string
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
}

/** Any declarative metric-transport entry, tagged by `type`. */
export type FroggerMetricTransportConfig =
    | MetricFileTransportConfig
    | MetricMemoryTransportConfig
    | MetricObserveTransportConfig

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

/**
 * A single normalised HTTP metric transport - a field-compatible subset of the
 * log `ResolvedHttpTransport`, kept separate so the two pipelines stay
 * type-independent. `apiKey` is discrete (never folded into `headers`) so
 * send-site code applies auth uniformly and diagnostics can redact it.
 */
export interface ResolvedMetricHttpTransport {
    type: 'http'
    name: string
    baseUrl: string
    endpoint: string
    apiKey?: string
    /** Where `apiKey` is applied at send time. @default 'header' */
    apiKeyLocation?: 'header' | 'query'
    /** Does NOT include `x-api-key`; that's applied at send time from `apiKey`. */
    headers: Record<string, string>
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
    /** Max events per outgoing batch chunk (observe: 500). Unset = no cap. */
    maxBatchEvents?: number
    /** Max serialized body bytes per chunk (observe: ~950 KiB). Unset = no cap. */
    maxBodyBytes?: number
    /**
     * Suppresses the bundle-visible-apiKey build warning for a client entry.
     * Set for observe browser keys (write-only public by design).
     */
    publicKeyOk?: boolean
}

/** A server-bound metric transport: file, memory or HTTP relay. */
export type ResolvedMetricServerTransport =
    | ResolvedMetricFileTransport
    | ResolvedMetricMemoryTransport
    | ResolvedMetricHttpTransport

/**
 * A client-bound metric transport (browser-direct HTTP fan-out).
 * ⚠️ Lands in `public` runtime config - its `apiKey` ships in the bundle.
 */
export type ResolvedMetricClientTransport = ResolvedMetricHttpTransport
