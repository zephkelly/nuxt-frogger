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
 *  - drain any buffered batch on page exit (beacon / keepalive) so navigating
 *    away never drops logs.
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
            // `visibilitychange -> hidden` is the primary exit signal: it is
            // the only one that reliably fires on mobile Safari and Chrome.
            // `pagehide` is the secondary net for desktop navigation and tab
            // close. `exitFlush` is idempotent, so both firing sends once.
            const drain = () => {
                try {
                    getLogQueue(nuxtApp as Record<string, any>).exitFlush();
                }
                catch {
                    // The page is unloading; there is nothing left to recover to.
                }
            };

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') drain();
            });
            window.addEventListener('pagehide', drain);

            // A bfcache restore is not an exit after all: re-arm so the next
            // real exit still drains.
            window.addEventListener('pageshow', (event) => {
                if ((event as PageTransitionEvent).persisted) {
                    try {
                        getLogQueue(nuxtApp as Record<string, any>).resumeAfterExit();
                    }
                    catch {
                        // Queue not resolvable yet: nothing was buffered anyway.
                    }
                }
            });
        }
    },
})
