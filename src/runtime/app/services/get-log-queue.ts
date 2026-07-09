import { LogQueueService } from './log-queue';

/**
 * Where the single client log queue is cached on the Nuxt app instance. Kept as
 * `$logQueue` for continuity with the previous `provide('logQueue', ...)` key,
 * so a queue placed there by the lifecycle plugin (or by older code) is reused.
 */
export const LOG_QUEUE_KEY = '$logQueue';

/**
 * Lazily resolve the client log queue, creating and caching ONE instance on the
 * Nuxt app the first time it is needed.
 *
 * This exists to remove a boot-order hazard: `frogger.*` is a drop-in for
 * `console.*`, but the queue used to be *injected* by a plugin, so any log
 * emitted before that plugin ran dereferenced an undefined `$logQueue` and was
 * silently dropped. Resolving lazily removes the window by construction — the
 * queue's only construction dependency is runtime config, which is available at
 * any point in the app lifecycle — so there is no ordering left to get wrong.
 *
 * The app instance scopes the cache: on the server every request has its own
 * `nuxtApp`, so this stays per-request during SSR too.
 */
export function getLogQueue(nuxtApp: Record<string, any>): LogQueueService {
    let queue = nuxtApp[LOG_QUEUE_KEY] as LogQueueService | undefined;

    if (!queue) {
        queue = new LogQueueService();
        nuxtApp[LOG_QUEUE_KEY] = queue;
    }

    return queue;
}
