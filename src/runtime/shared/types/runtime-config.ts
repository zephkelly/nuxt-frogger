import type { LogType } from 'consola'

import type { AppInfoOptions } from '../../app-info/types'
import type { BatchOptions } from './batch'
import type { LogContext } from './log'
import type { FroggerResource } from './resource'
import type { GlobalErrorCaptureOptions } from './global-error'
import type { ResolvedConsoleOutput, ResolvedLogLevel } from '../utils/resolve-options'
import type { ResolvedSpanEvents } from '../utils/span-events'
import type { ResolvedSampling } from '../utils/sampling'
import type { ScrubberOptions } from '../../scrubber/options'
import type { RateLimitingOptions } from '../../rate-limiter/types'
import type { WebsocketOptions } from '../../websocket/types/options'
import type { ResolvedHttpTransport, ResolvedServerTransport } from './transports'
import type { InternalLogLevel } from '../utils/internal-log'
import type {
    ResolvedMetricClientTransport,
    ResolvedMetricServerTransport,
} from '../../metrics/shared/types/metric-transports'
import type { ResolvedRequestMetrics, ResolvedRuntimeMetrics } from '../../metrics/shared/types/metric-options'

/**
 * The exact shape `module.ts` writes into `runtimeConfig.public.frogger`.
 *
 * Declaring it once, and typing BOTH the writer and every reader against it, is
 * the point: the module used to hand-build an untyped object literal while ~40
 * call sites cast their way in independently behind `@ts-ignore`, so nothing
 * checked that what was written matched what was read. That is exactly how
 * `public.serverModule` became a documented option with zero readers.
 */
export interface FroggerPublicRuntimeConfig {
    app: AppInfoOptions
    resource: FroggerResource
    context?: LogContext
    /** Frogger's own diagnostics threshold, NOT the application log level. */
    logLevel: InternalLogLevel
    /** The application log threshold, per runtime. */
    level: ResolvedLogLevel
    consoleOutput: ResolvedConsoleOutput
    clientModule: boolean
    serverModule: boolean
    /** `false` disables the client POST to the app's own ingest route. */
    endpoint: string | false
    baseUrl: string
    batch: BatchOptions | false
    spans: ResolvedSpanEvents
    /** Outbound trace-header allow-list. Same-origin is always permitted. */
    tracePropagation: false | { urls?: (string | RegExp)[] }
    scrub: ScrubberOptions | false
    websocket?: { route: string; defaultChannel: string }
    errorCapture: GlobalErrorCaptureOptions['client'] | false
    /** Bundle-visible by construction; any apiKey here is readable by visitors. */
    transports: ResolvedHttpTransport[]
    /** Present ONLY when the metrics subsystem is enabled. */
    metrics?: FroggerPublicMetricsConfig
}

export interface FroggerPublicMetricsConfig {
    endpoint: string | false
    webVitals: unknown
    deviceStats: unknown
    sampleRate: number
    maxEventsPerPage: number
    batch: BatchOptions | false
    transports: ResolvedMetricClientTransport[]
}

/** The shape `module.ts` writes into the private `runtimeConfig.frogger`. */
export interface FroggerServerRuntimeConfig {
    serverModule: boolean | { autoEventCapture?: boolean }
    resource: FroggerResource
    context?: LogContext
    logLevel: InternalLogLevel
    /** Server transports keep their apiKeys out of the client bundle. */
    transports: ResolvedServerTransport[]
    batch: BatchOptions | false
    sampling: ResolvedSampling
    rateLimit: RateLimitingOptions | false
    websocket: WebsocketOptions | false
    scrub: ScrubberOptions | false
    errorCapture: GlobalErrorCaptureOptions['server'] | false
    metrics?: {
        transports: ResolvedMetricServerTransport[]
        batch: BatchOptions | false
        requests: ResolvedRequestMetrics | false
        runtime: ResolvedRuntimeMetrics | false
    }
}

declare module 'nuxt/schema' {
    interface PublicRuntimeConfig {
        frogger: FroggerPublicRuntimeConfig
    }

    interface RuntimeConfig {
        frogger: FroggerServerRuntimeConfig
    }
}

export type { LogType }
