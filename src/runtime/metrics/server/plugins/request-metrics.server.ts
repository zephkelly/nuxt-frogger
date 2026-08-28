import type { H3Event } from 'h3'

//@ts-ignore
import { defineNitroPlugin } from '#imports'

import { froggerMetrics } from '../utils/metrics'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { useFroggerServerConfig } from '../../../shared/utils/use-frogger-config'
import { monotonicNow, elapsedSeconds } from '../../../shared/utils/now'
import { routePatternOf, isSelfRequest, HTTP_DURATION_BUCKETS } from '../../shared/utils/request-metrics'

/**
 * Per-request instrumentation from Nitro's own hooks.
 *
 * Frogger already held the H3 event for the whole request and never timed it,
 * so the single most valuable server signal - per-route latency, status and
 * error rate - was absent from a package that advertises performance tracking.
 * Users got it only by wrapping every handler in `frogger.span()` by hand.
 */
//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const requests = useFroggerServerConfig().metrics?.requests
    if (!requests) return

    nitroApp.hooks.hook('request', (event: H3Event) => {
        // Monotonic: a wall-clock delta can go backwards across an NTP step and
        // produce a negative duration.
        event.context.froggerRequestStart = monotonicNow()
    })

    nitroApp.hooks.hook('afterResponse', (event: H3Event) => {
        try {
            emitRequestMetric(event)
        }
        catch (err) {
            froggerInternal.error('Request metrics: failed to record', err)
        }
    })

    if (requests.serverTiming) {
        nitroApp.hooks.hook('beforeResponse', (event: H3Event) => {
            try {
                applyServerTiming(event)
            }
            catch {
                // A diagnostic header is never worth failing a response over.
            }
        })
    }
})

function emitRequestMetric(event: H3Event): void {
    const start = event.context.froggerRequestStart as number | undefined
    if (start === undefined) return

    // Never instrument our own ingest: a metric about the metrics POST produces
    // the next batch, which produces the next metric.
    if (isSelfRequest(event.path)) return

    const route = routePatternOf(event)
    // The rule that express-prom-bundle exists to retrofit: use the matched
    // PATTERN, and if there isn't one, drop the measurement rather than falling
    // back to the raw URL and exploding the series count.
    if (!route) return

    const status = event.node?.res?.statusCode ?? 200

    froggerMetrics.histogram('http.server.request.duration', elapsedSeconds(start), {
        unit: 'second',
        labels: {
            'http.request.method': event.method ?? 'GET',
            'http.route': route,
            'http.response.status_code': status,
        },
        attr: {
            // The bucket set is advisory for a collection-only package: nothing
            // here aggregates, but a downstream that does should use OTel's.
            buckets: HTTP_DURATION_BUCKETS.join(','),
        },
    })
}

/**
 * Surface the request's completed spans as `Server-Timing`, so a developer sees
 * the server breakdown in browser devtools without a backend at all.
 */
function applyServerTiming(event: H3Event): void {
    const timings = event.context.froggerTimings as { name: string, dur: number }[] | undefined
    if (!timings?.length) return

    const header = timings
        .slice(0, 20)
        .map(t => `${sanitizeTimingName(t.name)};dur=${t.dur.toFixed(1)}`)
        .join(', ')

    event.node?.res?.setHeader?.('Server-Timing', header)
}

/** `Server-Timing` names are tokens: no spaces, quotes or separators. */
function sanitizeTimingName(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64)
}
