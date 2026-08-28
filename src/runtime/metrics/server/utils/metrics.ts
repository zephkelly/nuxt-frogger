import type { H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime/internal/context'

import type { MetricObject } from '../../shared/types/metric'
import type { FroggerMetrics, MetricStamp } from '../../shared/api/types'
import type { TraceContext } from '../../../shared/types/trace-headers'

import { ServerMetricsQueueService } from '../services/server-metrics-queue'
import { createMetricsFacade } from '../../shared/api/facade'
import { traceFromLogger } from '../../shared/api/trace-of'
import { getActiveLogger } from '../../../logger/active-context.server'

/**
 * Ambient correlation for a server-recorded point, resolved in the same order
 * as the ambient logger so a metric and the rows around it agree:
 *
 *  1. an open `frogger.span(...)`, whose child carries the request trace,
 *  2. the current request's incoming trace context,
 *  3. nothing, for a cron task or startup, rather than a fabricated trace.
 */
function serverStamp(): MetricStamp {
    const active = getActiveLogger()
    if (active) {
        const trace = traceFromLogger(active)
        if (trace) return { env: 'server', trace }
    }

    let event: H3Event | undefined
    try {
        event = useEvent()
    }
    catch {
        // Outside a request (task, startup, background work): no exemplar.
        event = undefined
    }

    const traceContext = event?.context?.frogger as TraceContext | undefined
    if (traceContext?.traceId) {
        return { env: 'server', trace: { traceId: traceContext.traceId, spanId: traceContext.spanId } }
    }

    return { env: 'server' }
}

function record(metric: MetricObject): void {
    ServerMetricsQueueService.getInstance().enqueueMetric(metric)
}

/**
 * Ambient, zero-ceremony metrics recorder for Nitro routes, utils and tasks.
 *
 * ```ts
 * froggerMetrics.counter('order.created')
 * froggerMetrics.histogram('db.query.duration', seconds, { unit: 'second' })
 * ```
 *
 * Registered as an auto-import only when the metrics subsystem is enabled, so
 * a bare install never pulls the metrics queue into the server bundle.
 */
export const froggerMetrics: FroggerMetrics = createMetricsFacade(record, serverStamp)
