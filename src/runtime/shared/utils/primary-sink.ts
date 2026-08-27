import { DEFAULT_LOGGING_ENDPOINT } from '../types/module-options'

export interface PrimarySinkInputs {
    serverModuleEnabled: boolean
    /** `false` means the client POST was deliberately disabled. */
    endpoint: string | false | undefined | null
    baseUrl?: string | null
}

/**
 * Whether the app has a live primary log sink: somewhere the client queue's
 * POST actually lands. True when the app ingests its own logs (serverModule),
 * or when it relays to another origin (`public.baseUrl`), or when the
 * endpoint was customised away from the default self-route.
 *
 * This is THE shared truth for "do client logs leave this app". The build-time
 * banners, the batch queue's primary-send gate and the immediate-send path all
 * defer to it; they previously each re-derived it and drifted (the build
 * warning and `sendLogImmediate` both ignored `baseUrl`, so a relay app was
 * warned at boot and silently dropped its unbatched/fallback sends).
 */
export function hasPrimaryLogSink(inputs: PrimarySinkInputs): boolean {
    if (inputs.endpoint === false || !inputs.endpoint) return false
    if (inputs.serverModuleEnabled) return true
    return inputs.endpoint !== DEFAULT_LOGGING_ENDPOINT || !!inputs.baseUrl
}
