import { useNuxtApp } from '#imports'

import type { MetricObject } from '../../shared/types/metric'
import type { FroggerMetrics, MetricStamp } from '../../shared/api/types'

import { getMetricsQueue } from '../services/get-metrics-queue'
import { createMetricsFacade } from '../../shared/api/facade'
import { traceFromLogger } from '../../shared/api/trace-of'
import { getActiveLogger } from '../../../logger/active-context.client'
import { getAmbientClientLogger } from '../../../app/frogger'
import { froggerInternal } from '../../../shared/utils/internal-log'

/** The queue is cached on the Nuxt app instance, which it reads structurally. */
type MetricsHost = Record<string, unknown>

function resolveHost(): MetricsHost | undefined {
    try {
        return useNuxtApp() as MetricsHost
    }
    catch {
        // Outside the Nuxt app context: nothing to record into.
        return undefined
    }
}

/**
 * Route pattern at RECORD time, never the resolved path.
 *
 * Deliberately not shared with the Web Vitals collector, which freezes the
 * route at plugin init: CLS and INP report at page hide, after an SPA
 * navigation may have moved the current route, so for a vital the init reading
 * is the correct attribution. A manually recorded point has no such deferral
 * and belongs to the route it was recorded on.
 */
function currentRoutePattern(host: MetricsHost | undefined): string | undefined {
    try {
        const router = host?.$router as { currentRoute?: { value?: { matched?: { path?: string }[] } } } | undefined
        const matched = router?.currentRoute?.value?.matched
        return matched?.[matched.length - 1]?.path
    }
    catch {
        return undefined
    }
}

function clientStamp(): MetricStamp {
    const host = resolveHost()
    const queue = host ? getMetricsQueue(host) : undefined

    // An open span wins, matching the ambient logger's own resolution order;
    // otherwise the page-level ambient logger provides the exemplar.
    const active = getActiveLogger()
    const trace = (active && traceFromLogger(active)) ?? traceFromLogger(getAmbientClientLogger())

    return {
        env: import.meta.client ? 'client' : 'ssr',
        trace,
        session: queue?.getSession(),
        route: currentRoutePattern(host),
    }
}

function record(metric: MetricObject): void {
    const host = resolveHost()
    if (!host) {
        froggerInternal.debug('Metric recorded outside the Nuxt app context - dropped.')
        return
    }
    getMetricsQueue(host).enqueueMetric(metric)
}

/**
 * Ambient, zero-ceremony metrics recorder for client code.
 *
 * ```ts
 * froggerMetrics.counter('checkout.started')
 * const stop = froggerMetrics.timer('chart.render')
 * stop()
 * ```
 *
 * Points share the session sampling decision and the per-page budget with Web
 * Vitals, except that vitals are exempt from the budget so a hot custom metric
 * can never silence them.
 */
export const froggerMetrics: FroggerMetrics = createMetricsFacade(record, clientStamp)

/**
 * Stamp the acting user onto this session's metric batches. Call once at
 * sign-in and pass `undefined` at sign-out; never per point.
 */
export function setFroggerMetricsUser(user: string | undefined): void {
    const host = resolveHost()
    if (host) getMetricsQueue(host).setUser(user)
}
