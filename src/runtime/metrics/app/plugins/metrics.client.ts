import { useRuntimeConfig } from '#imports'
import { defineNuxtPlugin } from '#app'

import { getMetricsQueue } from '../services/get-metrics-queue'
import { collectDeviceContext } from '../collector/device'
import { registerWebVitals, type WebVitalStamp } from '../collector/web-vitals'
import {
    METRICS_SESSION_STORAGE_KEY,
    decideSampled,
    parseSession,
    type MetricsSession,
} from '../session'

import { getAmbientClientLogger } from '../../../app/frogger'
import { getActiveLogger } from '../../../logger/active-context.client'
import { parseTraceparent } from '../../../shared/utils/trace-headers'
import { uuidv7 } from '../../../shared/utils/uuid'
import { froggerInternal } from '../../../shared/utils/internal-log'
import type { IFroggerLogger } from '../../../logger/types'

/** Best-effort {traceId, spanId} from a logger's W3C trace headers. */
function traceFromLogger(logger: IFroggerLogger): { traceId: string; spanId?: string } | undefined {
    try {
        const traceparent = logger.getHeaders().traceparent
        if (!traceparent) return undefined
        const parsed = parseTraceparent(traceparent)
        if (parsed) return { traceId: parsed.traceId, spanId: parsed.spanId }
    }
    catch {
        // logger without trace headers — no exemplar
    }
    return undefined
}

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
        //@ts-ignore — public.frogger.metrics is present only when metrics are on
        const metricsConfig = config.public?.frogger?.metrics as {
            webVitals?: { reportAllChanges: boolean } | false
            deviceStats?: boolean
            sampleRate?: number
        } | undefined

        if (!metricsConfig) return

        const app = nuxtApp as unknown as Record<string, any>

        // Load-or-mint the session sampling decision, persisted so it survives
        // hard reloads within the tab.
        let session: MetricsSession
        try {
            const existing = parseSession(sessionStorage.getItem(METRICS_SESSION_STORAGE_KEY))
            if (existing) {
                session = existing
            }
            else {
                session = { id: uuidv7(), sampled: decideSampled(metricsConfig.sampleRate ?? 1, Math.random()) }
                sessionStorage.setItem(METRICS_SESSION_STORAGE_KEY, JSON.stringify(session))
            }
        }
        catch {
            // sessionStorage unavailable (privacy mode) — decide in-memory only.
            session = { id: uuidv7(), sampled: decideSampled(metricsConfig.sampleRate ?? 1, Math.random()) }
        }

        const queue = getMetricsQueue(app)
        queue.setSession(session)

        // A sampled-out session collects nothing — do no further work.
        if (!session.sampled) return

        // Device envelope: read once, rides the batch (never per point).
        if (metricsConfig.deviceStats !== false) {
            queue.setContext(collectDeviceContext())
        }

        // Trace exemplar + route pattern, both captured ONCE at init. Reading
        // the route at report time would mis-attribute — CLS/INP report at page
        // hide, after SPA navigation may have moved the current route.
        const pageTrace = traceFromLogger(getAmbientClientLogger())

        let route: string | undefined
        try {
            const matched = app.$router?.currentRoute?.value?.matched
            const last = matched?.[matched.length - 1]
            route = last?.path
        }
        catch {
            route = undefined
        }

        const resolveStamp = (): WebVitalStamp => {
            // An active span at callback time is an opportunistic override; the
            // page-level trace is the load-bearing path (vitals fire from a
            // PerformanceObserver, essentially never inside a user span).
            const active = getActiveLogger()
            const trace = (active && traceFromLogger(active)) || pageTrace
            return { trace, route }
        }

        if (metricsConfig.webVitals !== false) {
            void registerWebVitals(
                metricsConfig.webVitals || {},
                metric => queue.enqueueMetric(metric),
                resolveStamp,
            ).catch(err => froggerInternal.error('Failed to register web-vitals collector:', err))
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
