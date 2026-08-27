import { MetricsQueueService } from './metrics-queue'

/**
 * Where the single client metrics queue is cached on the Nuxt app instance.
 * Deliberately not plugin-injected - same boot-order reasoning as
 * `get-log-queue.ts`: resolving lazily on first use removes any window in which
 * an early caller could dereference an unready queue.
 */
export const METRICS_QUEUE_KEY = '$froggerMetricsQueue'

/**
 * Lazily resolve the client metrics queue, creating and caching ONE instance on
 * the Nuxt app the first time it is needed. The queue's only construction
 * dependency is runtime config, available at any point in the app lifecycle.
 */
export function getMetricsQueue(nuxtApp: Record<string, any>): MetricsQueueService {
    let queue = nuxtApp[METRICS_QUEUE_KEY] as MetricsQueueService | undefined

    if (!queue) {
        queue = new MetricsQueueService()
        nuxtApp[METRICS_QUEUE_KEY] = queue
    }

    return queue
}
