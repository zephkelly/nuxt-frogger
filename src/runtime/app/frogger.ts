import { computed } from 'vue'
import { useNuxtApp, useState } from '#imports'

import { ClientFrogger } from '../logger/client'
import { createAmbientFrogger } from '../logger/ambient'
import { getActiveLogger } from '../logger/active-context.client'
import type { FroggerAmbient } from '../logger/ambient'
import type { IFroggerLogger } from '../logger/types'

import { APP_MOUNTED_STATE_KEY } from '../shared/types/module-options'

// Cached on the Nuxt app instance: ONE ambient logger per app (so all casual
// `frogger.*` calls share a single span chain). On the server each request has
// its own nuxtApp, so this stays per-request during SSR too.
const AMBIENT_KEY = '$froggerAmbientLogger'

function getAmbientClientLogger(): IFroggerLogger {
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
        nuxtApp[AMBIENT_KEY] = new ClientFrogger(computed(() => hasMounted.value))
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
