import { useState, useRuntimeConfig } from '#imports';
import { defineNuxtPlugin } from '#app';
import { getLogQueue } from '../services/get-log-queue';

import { APP_MOUNTED_STATE_KEY } from '../../shared/types/module-options';
import { configureInternalLog, type InternalLogLevel } from '../../shared/utils/internal-log';

/**
 * Lifecycle wiring for the client log queue. It deliberately no longer
 * *provides* the queue: the queue is resolved lazily on first use via
 * {@link getLogQueue}, so `frogger.*` can never dereference an unready queue no
 * matter when it is first called relative to plugin boot. `enforce: 'pre'` only
 * ensures the internal-log level and mount flag are set as early as possible.
 *
 * Responsibilities:
 *  - configure Frogger's internal diagnostics level,
 *  - track `app:mounted` so client logs are tagged `client` vs `csr`,
 *  - flush any buffered batch on page hide so navigating away never drops logs.
 */
export default defineNuxtPlugin({
    name: 'frogger:log-queue',
    enforce: 'pre',
    setup(nuxtApp) {
        const froggerConfig = useRuntimeConfig().public.frogger as { logLevel?: InternalLogLevel } | undefined;
        configureInternalLog(froggerConfig?.logLevel);

        //@ts-ignore
        const isAppMounted = useState<boolean>(APP_MOUNTED_STATE_KEY, () => false);

        nuxtApp.hook('app:mounted', () => {
            isAppMounted.value = true;
        });

        if (import.meta.client && typeof window !== 'undefined') {
            // `pagehide` fires on both navigation and tab close and is the
            // reliable last chance to drain buffered logs before unload.
            window.addEventListener('pagehide', () => {
                void getLogQueue(nuxtApp as Record<string, any>).flush();
            });
        }
    },
})
