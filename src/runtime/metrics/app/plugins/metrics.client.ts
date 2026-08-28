import { useRuntimeConfig } from '#imports'
import { defineNuxtPlugin } from '#app'

import { getMetricsQueue } from '../services/get-metrics-queue'
import { collectDeviceContext } from '../collector/device'
import { registerWebVitals, type WebVitalStamp } from '../collector/web-vitals'
import {
    resolveSession,
    type MetricsSession,
} from '../../../shared/session'

import { getAmbientClientLogger } from '../../../app/frogger'
import { getActiveLogger } from '../../../logger/active-context.client'
import { parseTraceparent } from '../../../shared/utils/trace-headers'
import { uuidv7 } from '../../../shared/utils/uuid'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { setSpanMetricSink } from '../../../shared/utils/span-metric-sink'
import { setIdentitySink } from '../../../shared/utils/identity-sink'
import { traceFromLogger } from '../../shared/api/trace-of'
import { froggerMetrics } from '../utils/metrics'
import type { IFroggerLogger } from '../../../logger/types'

// The shared implementation: reads the logger's own stable span rather than
// round-tripping through a traceparent, so the exemplar names the span that
// actually contains the point, and keeps the sampling decision.

/**
 * Metrics collector plugin. Registered only when the metrics subsystem and the
 * client module are both enabled, so a bare install never loads it (and
 * `web-vitals` never reaches the bundle).
 *
 * It mints/loads the per-session sampling decision, captures the page's trace
 * exemplar and route pattern once at init, wires the Web Vitals + device
 * collectors, and flushes on `visibilitychange → hidden` (primary) + `pagehide`
 * (secondary) via `sendBeacon`.
 */
export default defineNuxtPlugin({
    name: 'frogger:metrics',
    setup(nuxtApp) {
        const config = useRuntimeConfig()
        //@ts-ignore - public.frogger.metrics is present only when metrics are on
        const metricsConfig = config.public?.frogger?.metrics as {
            webVitals?: { reportAllChanges: boolean, attribution?: boolean } | false
            deviceStats?: boolean
            sampleRate?: number
        } | undefined

        if (!metricsConfig) return

        const app = nuxtApp as unknown as Record<string, any>

        // Load-or-mint the session sampling decision, persisted so it survives
        // hard reloads within the tab. Shared with the log pipeline, so a log
        // and a Web Vital from the same page load carry the same session id.
        const session: MetricsSession = resolveSession(metricsConfig.sampleRate ?? 1)

        const queue = getMetricsQueue(app)
        queue.setSession(session)

        // One `frogger.identify()` sets the user for BOTH pipelines. Wired
        // through a sink so the logger never imports the metrics tree.
        setIdentitySink(user => queue.setUser(user))

        // A sampled-out session collects nothing - do no further work.
        if (!session.sampled) return

        // Device envelope: read once, rides the batch (never per point).
        if (metricsConfig.deviceStats !== false) {
            queue.setContext(collectDeviceContext())
        }

        // Route pattern captured ONCE at init (it only reads `$router`).
        // Reading the route at report time would mis-attribute - CLS/INP report
        // at page hide, after SPA navigation may have moved the current route.
        let route: string | undefined
        try {
            const matched = app.$router?.currentRoute?.value?.matched
            const last = matched?.[matched.length - 1]
            route = last?.path
        }
        catch {
            route = undefined
        }

        // The page trace is resolved LAZILY on the first vital, never during
        // plugin setup: `getAmbientClientLogger()` force-constructs the ambient
        // logger and fires the one-shot `frogger:init` hook, and doing that in
        // setup() would fire it before user plugins have registered handlers.
        // Memoised inside the fallback branch only - when a span is open the
        // ambient accessor returns the span logger, and an unguarded memo would
        // freeze that span's trace as the page trace.
        let pageTrace: { traceId: string; spanId?: string } | undefined
        let pageTraceResolved = false

        const resolveStamp = (): WebVitalStamp => {
            // An active span at callback time is an opportunistic override; the
            // page-level trace is the load-bearing path (vitals fire from a
            // PerformanceObserver, essentially never inside a user span).
            const active = getActiveLogger()
            const activeTrace = active && traceFromLogger(active)
            if (activeTrace) {
                return { trace: activeTrace, route }
            }

            if (!pageTraceResolved) {
                pageTraceResolved = true
                pageTrace = traceFromLogger(getAmbientClientLogger())
            }
            return { trace: pageTrace, route }
        }

        if (metricsConfig.webVitals !== false) {
            void registerWebVitals(
                metricsConfig.webVitals || {},
                metric => queue.enqueueMetric(metric),
                resolveStamp,
            ).catch(err => froggerInternal.error('Failed to register web-vitals collector:', err))
        }

        // Turn every existing span call site into latency data. Registered
        // here, not imported by the logger, so the two trees stay independent.
        setSpanMetricSink((name, durationSeconds, ok, labels, trace) => {
            froggerMetrics.histogram('span.duration', durationSeconds, {
                unit: 'second',
                labels: { span: name, ok, ...labels },
                // The span's OWN exemplar. Without it the ambient resolver runs
                // after the span's scope has exited and attributes the
                // measurement to the enclosing span.
                trace,
            })
        })

        // SPA navigation is the page boundary `maxEventsPerPage` is named for.
        try {
            app.$router?.afterEach?.(() => queue.resetPage())
        }
        catch {
            // No router (or a stubbed one): the cap stays per app boot.
        }

        if (import.meta.client && typeof window !== 'undefined') {
            // `visibilitychange → hidden` is the primary exit signal (survives
            // bfcache, reliable on mobile); `pagehide` is the secondary net.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    void queue.flush(true)
                }
            })
            window.addEventListener('pagehide', () => {
                void queue.flush(true)
            })
        }
    },
})
