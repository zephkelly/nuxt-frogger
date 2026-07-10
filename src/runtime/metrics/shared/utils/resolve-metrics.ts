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
    ResolvedMetricServerTransport,
    ResolvedMetricClientTransport,
} from '../types/metric-transports'

/**
 * Metrics options resolution. Mirrors the *structure* of `resolve-options.ts`
 * (false-or-full-object normalisation, a switch-on-`type` transport split, and
 * deliberately distinct server/client batch defaults) while sharing none of its
 * body types — the metrics pipeline is fully parallel to the log pipeline.
 *
 * Metrics are OFF by default and never touched by a preset (like `transports`):
 * `resolveMetricsOptions(false | undefined)` returns `false`, and everything
 * downstream stays fully inert.
 */

export const DEFAULT_METRICS_ENDPOINT = '/api/_frogger/metrics'

/** Raw metric events land here; distinct from the log files' `logs/`. */
export const DEFAULT_METRICS_FILE: Required<FileOptions> = {
    ...DEFAULT_FILE,
    directory: 'logs/metrics',
}

/**
 * SERVER metrics-queue batching default — a long window (matches the log
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
 * CLIENT metrics-queue batching default — a shorter window than the server
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
 * Split the declarative metric `transports` list into server-bound (file +
 * memory) and client-bound transports. Client HTTP fan-out is a Phase 2
 * capability, so the client list is always empty in v1; the split shape is
 * kept stable for it.
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

        froggerInternal.warn(`Unknown metric transport type "${(t as { type?: string }).type}" — skipping.`)
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
