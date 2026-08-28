import { useRuntimeConfig } from '#imports'

import type {
    FroggerPublicRuntimeConfig,
    FroggerServerRuntimeConfig,
} from '../types/runtime-config'

/**
 * The resolved public config, typed.
 *
 * Every reader used to cast its way in behind `@ts-ignore`, which meant a typo
 * or a key the module stopped writing produced `undefined` at runtime with no
 * signal anywhere. Reading through here types the access against the same
 * declaration `module.ts` writes.
 *
 * Deliberately tolerant about a MISSING config rather than throwing: this is
 * called from constructors that also run in tests and in bare Node contexts
 * where no Nuxt runtime config exists, and a logger failing to construct is a
 * worse outcome than one that logs to console with defaults.
 */
export function useFroggerConfig(): FroggerPublicRuntimeConfig {
    const config = useRuntimeConfig() as unknown as {
        public?: { frogger?: Partial<FroggerPublicRuntimeConfig> }
    }

    return (config?.public?.frogger ?? {}) as FroggerPublicRuntimeConfig
}

/**
 * The resolved server-only config, typed. Never reachable from the client
 * bundle: these keys carry transport apiKeys and rate-limit configuration.
 */
export function useFroggerServerConfig(): FroggerServerRuntimeConfig {
    const config = useRuntimeConfig() as unknown as {
        frogger?: Partial<FroggerServerRuntimeConfig>
    }

    return (config?.frogger ?? {}) as FroggerServerRuntimeConfig
}
