import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks'

//@ts-ignore
import { defineNitroPlugin } from '#imports'

import { froggerMetrics } from '../utils/metrics'
import { froggerInternal } from '../../../shared/utils/internal-log'
import { useFroggerServerConfig } from '../../../shared/utils/use-frogger-config'

/**
 * Node runtime health from `node:perf_hooks`, with zero new dependencies.
 *
 * Metric names and units are @opentelemetry/instrumentation-runtime-node's,
 * verbatim, so nothing downstream needs a translation table.
 *
 * Event-loop delay is the signal that explains "the server is slow but every
 * handler is fast": it measures how long the loop was blocked, which no
 * per-request timer can see.
 */
//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const runtime = useFroggerServerConfig().metrics?.runtime
    if (!runtime) return

    const intervalMs = runtime.intervalMs

    let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined
    let gcObserver: PerformanceObserver | undefined
    let timer: ReturnType<typeof setInterval> | undefined

    try {
        // 20ms resolution: fine enough to see a blocked loop, coarse enough
        // that the sampling itself is not the load.
        histogram = monitorEventLoopDelay({ resolution: 20 })
        histogram.enable()
    }
    catch (err) {
        froggerInternal.error('Runtime metrics: event loop monitor unavailable', err)
    }

    try {
        gcObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                froggerMetrics.histogram('v8js.gc.duration', entry.duration / 1000, {
                    unit: 'second',
                    labels: { 'v8js.gc.type': gcKindOf(entry as unknown as GcEntry) },
                })
            }
        })
        gcObserver.observe({ entryTypes: ['gc'] })
    }
    catch (err) {
        froggerInternal.error('Runtime metrics: GC observer unavailable', err)
    }

    let lastElu = performance.eventLoopUtilization?.()

    timer = setInterval(() => {
        try {
            sample()
        }
        catch (err) {
            froggerInternal.error('Runtime metrics: sample failed', err)
        }
    }, intervalMs)

    // Collecting metrics must never be the reason a process refuses to exit.
    timer.unref?.()

    nitroApp.hooks.hook('close', () => {
        if (timer) clearInterval(timer)
        gcObserver?.disconnect()
        histogram?.disable()
    })

    function sample(): void {
        if (histogram) {
            // Nanoseconds from perf_hooks; the convention is seconds.
            froggerMetrics.gauge('nodejs.eventloop.delay.p50', histogram.percentile(50) / 1e9, { unit: 'second' })
            froggerMetrics.gauge('nodejs.eventloop.delay.p90', histogram.percentile(90) / 1e9, { unit: 'second' })
            froggerMetrics.gauge('nodejs.eventloop.delay.p99', histogram.percentile(99) / 1e9, { unit: 'second' })
            histogram.reset()
        }

        if (performance.eventLoopUtilization) {
            // A DELTA since the last reading, not since process start: the
            // cumulative figure converges and stops telling you anything.
            const elu = performance.eventLoopUtilization(lastElu)
            lastElu = performance.eventLoopUtilization()
            froggerMetrics.gauge('nodejs.eventloop.utilization', elu.utilization, { unit: '' })
        }

        const memory = process.memoryUsage()
        froggerMetrics.gauge('v8js.memory.heap.used', memory.heapUsed, { unit: 'byte' })
        froggerMetrics.gauge('v8js.memory.heap.limit', memory.heapTotal, { unit: 'byte' })
        froggerMetrics.gauge('nodejs.memory.rss', memory.rss, { unit: 'byte' })
    }
})

interface GcEntry {
    detail?: { kind?: number }
    kind?: number
}

/** Map V8's numeric GC kind onto the OTel label values. */
function gcKindOf(entry: GcEntry): string {
    const kind = entry.detail?.kind ?? entry.kind

    switch (kind) {
        case 1: return 'minor'
        case 2: return 'major'
        case 4: return 'incremental'
        case 8: return 'weakcb'
        default: return 'unknown'
    }
}
