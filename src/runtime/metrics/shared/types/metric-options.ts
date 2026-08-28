import type { BatchOptions } from '../../../shared/types/batch'
import type {
    FroggerMetricTransportConfig,
    ResolvedMetricServerTransport,
    ResolvedMetricClientTransport,
} from './metric-transports'

/**
 * The metrics subsystem is a fully separate, opt-in capability from the logging
 * pipeline. It is OFF by default and never part of the `minimal`/`standard`/
 * `full` presets - enabling data collection is always an explicit choice.
 *
 * `metrics: true` turns on the free, bounded-cardinality signals only: Web
 * Vitals + a per-batch device envelope, plus the manual metrics API
 * (`froggerMetrics`) on both runtimes, which costs nothing until called.
 * Heavier auto-collection (resource timing, server runtime stats) gets its own
 * flag in later phases.
 */
export interface MetricsOptions {
    /**
     * Auto-collect Google Web Vitals (LCP/CLS/INP/FCP/TTFB). Default on when
     * metrics are enabled. Pass `{ reportAllChanges: true }` to emit every
     * intermediate value rather than the final per-page value only.
     *
     * `attribution: true` swaps to the `web-vitals/attribution` build, which
     * turns "LCP was 3.2s" into which element, and how the 3.2s split across
     * TTFB / resource load / render delay. The extra detail lands in the
     * NON-INDEXED `attr` slot, so it costs no cardinality - which is exactly
     * what the labels/attr split was built for. Off by default because the
     * attribution build is a larger bundle.
     */
    webVitals?: boolean | { reportAllChanges?: boolean, attribution?: boolean }

    /**
     * Attach a device/network/viewport envelope to each batch. Default on when
     * metrics are enabled.
     */
    deviceStats?: boolean

    /**
     * Per-request server instrumentation: route pattern, status code and
     * duration for every request, from Nitro's own response hooks.
     *
     * This is the single most valuable server signal, and Frogger already
     * holds the H3 event for the whole request - it just never timed it, so
     * users got latency only by wrapping every handler in `frogger.span()` by
     * hand.
     *
     * The route label is ALWAYS the matched route PATTERN, never the raw path:
     * a raw URL is unbounded cardinality, which is the single most common
     * footgun in Node metrics. A request whose pattern cannot be resolved is
     * dropped rather than falling back to the path.
     *
     * @default false
     */
    requests?: boolean | {
        /**
         * Emit `Server-Timing` response headers from the request's completed
         * spans, so browser devtools show the server breakdown inline.
         * Dev-only by default; it is a response-header cost on every request.
         *
         * @default false
         */
        serverTiming?: boolean
    }

    /**
     * Node runtime health: event-loop delay percentiles, event-loop
     * utilization, GC pause duration and heap usage, from `node:perf_hooks`
     * with no new dependencies.
     *
     * Event-loop delay is what explains "the server is slow but every handler
     * is fast" - no per-request timer can see a blocked loop.
     *
     * Metric names follow @opentelemetry/instrumentation-runtime-node exactly,
     * so nothing downstream needs a translation table.
     *
     * @default false
     */
    runtime?: boolean | {
        /** Sampling period in ms. @default 15000 */
        intervalMs?: number
    }

    /**
     * Session-level sampling rate in `[0, 1]`, decided ONCE per session (a
     * sampled-out session collects nothing). @default 1
     */
    sampleRate?: number

    /**
     * In-memory hard cap on metric events per page load. On overflow, events
     * are dropped and a single internal warning is emitted. @default 500
     */
    maxEventsPerPage?: number

    /**
     * SERVER metrics-queue batching. Distinct default from the client batch
     * (a longer window) so a single shared key can't churn server transports.
     */
    batch?: BatchOptions | false

    /** Metric destinations (parallel to logs - NOT the log `transports`). */
    transports?: FroggerMetricTransportConfig[]

    public?: {
        /** Ingest route the browser POSTs metric batches to. @default '/api/_frogger/metrics' */
        endpoint?: string | false
        /**
         * CLIENT metrics-queue batching. Distinct default from the server batch
         * (a shorter window) so client batches are not held too long.
         */
        batch?: BatchOptions | false
    }
}

/**
 * Fully-resolved metrics config. `false` means the whole subsystem is off (no
 * plugin, no route, no runtime-config keys). Otherwise every field is
 * normalised so downstream wiring never re-derives on/off state.
 */
export interface ResolvedRequestMetrics {
    serverTiming: boolean
}

export interface ResolvedRuntimeMetrics {
    intervalMs: number
}

export interface ResolvedMetricsOptions {
    webVitals: { reportAllChanges: boolean, attribution: boolean } | false
    runtime: ResolvedRuntimeMetrics | false
    requests: ResolvedRequestMetrics | false
    deviceStats: boolean
    sampleRate: number
    maxEventsPerPage: number
    batch: BatchOptions | false
    transports: {
        server: ResolvedMetricServerTransport[]
        client: ResolvedMetricClientTransport[]
    }
    public: {
        endpoint: string | false
        batch: BatchOptions | false
    }
}
