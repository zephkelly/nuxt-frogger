import type { FroggerResource } from '../types/resource'
import { RESOURCE_ENV_KEYS } from '../types/resource'
import { uuidv7 } from './uuid'

interface BuildResourceInput {
    appName?: string
    appVersion?: string
    /** Explicit `environment` module option, if the user set one. */
    environment?: string
    /** `nuxt.options.dev` - decides the environment default. */
    dev: boolean
}

const env = (key: string): string | undefined => {
    const value = typeof process !== 'undefined' ? process.env?.[key] : undefined
    return value && value.length > 0 ? value : undefined
}

/**
 * The build-time half of the resource: everything that is the same for every
 * boot of a given build. `service.instance.id` is deliberately absent - it must
 * be per process, so it is resolved at runtime by {@link getServerResource}.
 *
 * Env vars are read here as well as at runtime so a build-time-known value
 * (a CI-injected release) reaches the client bundle, which has no process.env.
 */
export function resolveBuildResource(input: BuildResourceInput): FroggerResource {
    const version = input.appVersion
    const resource: FroggerResource = {
        'deployment.environment':
            input.environment
            ?? env(RESOURCE_ENV_KEYS.environment)
            ?? (input.dev ? 'development' : 'production'),
    }

    if (input.appName) resource['service.name'] = input.appName
    if (version) resource['service.version'] = version

    const release = env(RESOURCE_ENV_KEYS.release) ?? version
    if (release) resource['service.release'] = release

    return resource
}

let serverResource: FroggerResource | undefined

/**
 * The build resource plus a `service.instance.id` that is stable for the life
 * of this process. Without it two Nitro instances behind a load balancer are
 * indistinguishable, so a fault localised to one node reads as a fault in the
 * app.
 */
export function getServerResource(base: FroggerResource | undefined): FroggerResource {
    if (serverResource) return serverResource

    serverResource = {
        ...base,
        // Re-read at runtime: an env var set on the host (not at build) is the
        // normal case for environment and release on a promoted build.
        ...(env(RESOURCE_ENV_KEYS.environment) ? { 'deployment.environment': env(RESOURCE_ENV_KEYS.environment) } : {}),
        ...(env(RESOURCE_ENV_KEYS.release) ? { 'service.release': env(RESOURCE_ENV_KEYS.release) } : {}),
        'service.instance.id': env(RESOURCE_ENV_KEYS.instanceId) ?? uuidv7(),
    }

    return serverResource
}

/** Test seam: forget the memoised per-process resource. */
export function resetServerResource(): void {
    serverResource = undefined
}
