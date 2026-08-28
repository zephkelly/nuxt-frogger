import { ServerMetricsQueueService } from '../services/server-metrics-queue'
import { setSpanMetricSink } from '../../../shared/utils/span-metric-sink'
import { froggerMetrics } from '../utils/metrics'

//@ts-ignore
import { defineNitroPlugin } from '#imports'

/**
 * Lifecycle plugin for the server metrics queue. Mirrors `log-queue.server.ts`
 * but is registered only when the metrics subsystem is enabled, so a bare
 * install never touches it. The internal-log level is already configured by the
 * log-queue plugin (always present when serverModule is on).
 */
//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const queue = ServerMetricsQueueService.getInstance()

    // Turn every existing span call site into latency data. Registered here,
    // not imported by the logger, so the two trees stay independent.
    setSpanMetricSink((name, durationSeconds, ok, labels, trace) => {
        froggerMetrics.histogram('span.duration', durationSeconds, {
            unit: 'second',
            labels: { span: name, ok, ...labels },
            // The span's OWN exemplar. Without it the ambient resolver runs
            // after the span's scope has exited and attributes the measurement
            // to the enclosing span.
            trace,
        })
    })

    // Graceful shutdown: drain the batch window (sorting window included) so
    // buffered metrics are not lost on deploys/restarts - log-queue parity.
    nitroApp.hooks.hook('close', async () => {
        await queue.drain()
    })
})
