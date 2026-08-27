import { defu } from 'defu'

import type { BatchOptions } from '../../../shared/types/batch'
import type { FileOptions } from '../../../shared/types/file'
import { DEFAULT_FILE } from '../../../shared/types/file'
import { normalizeToggle } from '../../../shared/utils/resolve-options'
import { froggerInternal } from '../../../shared/utils/internal-log'

import type { MetricsOptions, ResolvedMetricsOptions } from '../types/metric-options'
import type {
    FroggerMetricTransportConfig,
    MetricFileTransportConfig,
    MetricMemoryTransportConfig,
    MetricObserveTransportConfig,
    ResolvedMetricServerTransport,
    ResolvedMetricClientTransport,
    ResolvedMetricHttpTransport,
} from '../types/metric-transports'

/**
 * Metrics options resolution. Mirrors the *structure* of `resolve-options.ts`
 * (false-or-full-object normalisation, a switch-on-`type` transport split, and
 * deliberately distinct server/client batch defaults) while sharing none of its
 * body types - the metrics pipeline is fully parallel to the log pipeline.
 *
 * Metrics are OFF by default and never touched by a preset (like `transports`):
 * `resolveMetricsOptions(false | undefined)` returns `false`, and everything
 * downstream stays fully inert.
 */

// Single source of truth for the ingest route (module.ts registers from the
// same constant); re-exported here for existing importers/tests.
export { DEFAULT_METRICS_ENDPOINT } from '../../../shared/types/module-options'
import { DEFAULT_METRICS_ENDPOINT } from '../../../shared/types/module-options'

/** Raw metric events land here; distinct from the log files' `logs/`. */
export const DEFAULT_METRICS_FILE: Required<FileOptions> = {
    ...DEFAULT_FILE,
    directory: 'logs/metrics',
}

/**
 * SERVER metrics-queue batching default - a long window (matches the log
 * pipeline's `DEFAULT_BATCH` maxAge). Kept separate from the client default so
 * a single shared key can never churn server transports.
 */
export const DEFAULT_METRICS_BATCH: BatchOptions = {
    maxSize: 200,
    maxAge: 15000,
    retryOnFailure: true,
    maxRetries: 5,
    retryDelay: 10000,
    sortingWindowMs: 3000,
}

/**
 * CLIENT metrics-queue batching default - a shorter window than the server
 * default (vitals are sparse and page-exit flushes catch the tail), so client
 * batches are never held too long.
 */
export const DEFAULT_METRICS_PUBLIC_BATCH: BatchOptions = {
    maxSize: 100,
    maxAge: 5000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 3000,
    sortingWindowMs: 1000,
}

export const DEFAULT_MAX_EVENTS_PER_PAGE = 500

// nuxt-observe metrics ingest contract - the metrics sibling of the log
// OBSERVE_INGEST_PATH, with the same batch caps (mirroring observe's 413
// limits: 500 events / 1 MiB, sent with headroom).
const OBSERVE_METRICS_INGEST_PATH = '/api/observe/ingest/frogger/metrics'
const OBSERVE_MAX_BATCH_EVENTS = 500
const OBSERVE_MAX_BODY_BYTES = 950 * 1024

const DEFAULT_WEB_VITALS: { reportAllChanges: boolean } = { reportAllChanges: false }

/** Clamp a user-supplied sample rate into `[0, 1]`; default 1 when unset. */
function resolveSampleRate(value: number | undefined): number {
    if (value === undefined || Number.isNaN(value)) return 1
    return Math.min(1, Math.max(0, value))
}

/** Normalise a metric `file` entry. Server-only. */
function normalizeMetricFile(t: MetricFileTransportConfig): ResolvedMetricServerTransport {
    const { type: _type, name, ...fileOptions } = t
    return {
        type: 'file',
        name: name ?? 'file',
        options: defu(fileOptions, DEFAULT_METRICS_FILE) as Required<FileOptions>,
    }
}

/**
 * Expand an `observe` entry into per-side `ResolvedMetricHttpTransport`s
 * encoding the nuxt-observe metrics contract: header auth server-side, query
 * auth browser-side (observe resolves its CORS allowlist from the query string
 * during preflight, and `sendBeacon` cannot set headers at all), and the
 * metrics ingest path + batch caps on both. Verbatim sibling of the log
 * `normalizeObserve`. Returns `null` on an invalid `url`.
 */
function normalizeMetricObserve(t: MetricObserveTransportConfig): {
    server?: ResolvedMetricHttpTransport
    client?: ResolvedMetricHttpTransport
} | null {
    let origin: string
    try {
        origin = new URL(t.url).origin
    }
    catch {
        froggerInternal.warn(`Invalid metric observe url "${t.url}" - skipping this transport.`)
        return null
    }

    // Key is never embedded in `name` (diagnostics may surface it).
    const name = t.name ?? `observe (${origin})`

    const base = {
        type: 'http' as const,
        name,
        baseUrl: origin,
        endpoint: OBSERVE_METRICS_INGEST_PATH,
        headers: {} as Record<string, string>,
        timeout: t.timeout,
        retryOnFailure: t.retryOnFailure,
        maxRetries: t.maxRetries,
        retryDelay: t.retryDelay,
        maxBatchEvents: OBSERVE_MAX_BATCH_EVENTS,
        maxBodyBytes: OBSERVE_MAX_BODY_BYTES,
    }

    const result: { server?: ResolvedMetricHttpTransport; client?: ResolvedMetricHttpTransport } = {}

    if (t.server !== false) {
        result.server = { ...base, apiKey: t.key, apiKeyLocation: 'header' }
    }
    if (t.client === true) {
        result.client = { ...base, apiKey: t.key, apiKeyLocation: 'query', publicKeyOk: true }
    }

    return result
}

/**
 * Split the declarative metric `transports` list into server-bound (file +
 * memory + HTTP relay) and client-bound (HTTP fan-out) transports.
 */
function resolveMetricTransports(transports: FroggerMetricTransportConfig[] | undefined): {
    server: ResolvedMetricServerTransport[]
    client: ResolvedMetricClientTransport[]
} {
    const server: ResolvedMetricServerTransport[] = []
    const client: ResolvedMetricClientTransport[] = []

    for (const t of transports ?? []) {
        if (t.type === 'file') {
            server.push(normalizeMetricFile(t))
            continue
        }

        if (t.type === 'memory') {
            const mem = t as MetricMemoryTransportConfig
            if (mem.client === true) {
                froggerInternal.warn('A metric `memory` transport is server-only; `client: true` is ignored.')
            }
            server.push({ type: 'memory', name: mem.name ?? 'memory' })
            continue
        }

        if (t.type === 'observe') {
            const observe = normalizeMetricObserve(t)
            if (observe?.server) server.push(observe.server)
            if (observe?.client) client.push(observe.client)
            continue
        }

        froggerInternal.warn(`Unknown metric transport type "${(t as { type?: string }).type}" - skipping.`)
    }

    return { server, client }
}

/**
 * Resolve the top-level `metrics` module option into a fully-normalised config,
 * or `false` when the subsystem is off. `false`/`undefined` → off; `true` →
 * defaults (Web Vitals + device stats on); a partial object merges onto the
 * defaults.
 */
export function resolveMetricsOptions(
    value: MetricsOptions | boolean | undefined,
): ResolvedMetricsOptions | false {
    if (value === false || value === undefined) return false

    const opts: MetricsOptions = value === true ? {} : value

    // Web Vitals default ON when metrics are enabled (so an omitted key is
    // `true`, not off), and the partial `reportAllChanges?` is coerced to the
    // required shape so the resolved type stays `{ reportAllChanges: boolean } | false`.
    const webVitalsInput = opts.webVitals === false
        ? false
        : opts.webVitals === undefined || opts.webVitals === true
            ? true
            : { reportAllChanges: opts.webVitals.reportAllChanges ?? false }

    return {
        webVitals: normalizeToggle(webVitalsInput, DEFAULT_WEB_VITALS),
        deviceStats: opts.deviceStats !== false,
        sampleRate: resolveSampleRate(opts.sampleRate),
        maxEventsPerPage: opts.maxEventsPerPage ?? DEFAULT_MAX_EVENTS_PER_PAGE,
        batch: opts.batch === false ? false : defu(opts.batch, DEFAULT_METRICS_BATCH),
        transports: resolveMetricTransports(opts.transports),
        public: {
            endpoint: opts.public?.endpoint === false
                ? false
                : opts.public?.endpoint ?? DEFAULT_METRICS_ENDPOINT,
            batch: opts.public?.batch === false
                ? false
                : defu(opts.public?.batch, DEFAULT_METRICS_PUBLIC_BATCH),
        },
    }
}
