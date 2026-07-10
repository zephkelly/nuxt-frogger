import { ServerMetricsQueueService } from '../services/server-metrics-queue'

//@ts-ignore
import { defineNitroPlugin } from '#imports'

/**
 * Lifecycle plugin for the server metrics queue. Mirrors `log-queue.server.ts`
 * but is registered only when the metrics subsystem is enabled, so a bare
 * install never touches it. The internal-log level is already configured by the
 * log-queue plugin (always present when serverModule is on).
 */
//@ts-ignore
export default defineNitroPlugin(() => {
    ServerMetricsQueueService.getInstance()
})
