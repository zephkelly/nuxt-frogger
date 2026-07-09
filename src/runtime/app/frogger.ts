import { computed } from 'vue'
import { useNuxtApp, useState, useRuntimeConfig } from '#imports'

import { ClientFrogger } from '../logger/client'
import { createAmbientFrogger } from '../logger/ambient'
import { getActiveLogger } from '../logger/active-context.client'
import type { FroggerAmbient } from '../logger/ambient'
import type { IFroggerLogger } from '../logger/types'
import type { LogContext } from '../shared/types/log'

import { APP_MOUNTED_STATE_KEY } from '../shared/types/module-options'

// Cached on the Nuxt app instance: ONE ambient logger per app (so all casual
// `frogger.*` calls share a single span chain). On the server each request has
// its own nuxtApp, so this stays per-request during SSR too.
const AMBIENT_KEY = '$froggerAmbientLogger'

/**
 * Resolve the app-scoped ambient client logger, constructing it once on first
 * use. Boot-context is applied at construction: static base context from
 * `frogger.config.ts` (serialized into runtime config) is stamped first, then
 * the one-time `frogger:init` hook fires so a plugin can add dynamic base
 * context (tenant, per-deployment env) that can't be serialized. Synchronous
 * `frogger:init` handlers apply before the first log.
 *
 * Exported for testing; app code should use the `frogger` facade below.
 */
export function getAmbientClientLogger(): IFroggerLogger {
    // Inside frogger.span(...), every ambient call resolves to the span's
    // child logger so nested utils auto-nest (best-effort in the browser).
    const active = getActiveLogger()
    if (active) {
        return active
    }

    const nuxtApp = useNuxtApp() as Record<string, any>

    if (!nuxtApp[AMBIENT_KEY]) {
        //@ts-ignore - useState ref typing
        const hasMounted = useState<boolean>(APP_MOUNTED_STATE_KEY, () => false)

        // Static base context from config, cloned so per-logger mutations never
        // write back into the shared runtime-config object.
        const config = useRuntimeConfig()
        const baseContext = (config.public?.frogger as { context?: LogContext } | undefined)?.context

        const logger = new ClientFrogger(
            computed(() => hasMounted.value),
            baseContext ? { context: { ...baseContext } } : {},
        )

        // Cache BEFORE firing the hook so a handler that itself logs does not
        // recurse into a second construction.
        nuxtApp[AMBIENT_KEY] = logger
        nuxtApp.callHook?.('frogger:init', logger)
    }

    return nuxtApp[AMBIENT_KEY] as IFroggerLogger
}

/**
 * Ambient, zero-ceremony logger — a drop-in for `console.*` on the client.
 *
 * ```ts
 * frogger.info('user signed in', { userId })
 * frogger.error('checkout failed', err)
 * ```
 *
 * Backed by a single app-scoped {@link ClientFrogger}, so all calls form ONE
 * span chain. Reach for `useFrogger()` when you want a fresh/independent span
 * or scoped context.
 */
export const frogger: FroggerAmbient = createAmbientFrogger(getAmbientClientLogger)

declare module '#app' {
    interface RuntimeNuxtHooks {
        /**
         * Fired once with the ambient client logger the first time it is
         * resolved, before its first log. Tap it from a client plugin to stamp
         * dynamic base context that can't be serialized into `frogger.config.ts`
         * (per-session tenant, per-deployment env). Handlers should be
         * synchronous for the context to affect the very first log.
         */
        'frogger:init': (frogger: IFroggerLogger) => void | Promise<void>
    }
}
