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
     */
    webVitals?: boolean | { reportAllChanges?: boolean }

    /**
     * Attach a device/network/viewport envelope to each batch. Default on when
     * metrics are enabled.
     */
    deviceStats?: boolean

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
export interface ResolvedMetricsOptions {
    webVitals: { reportAllChanges: boolean } | false
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
