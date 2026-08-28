/**
 * Deployment identity, resolved once at module setup and stamped on the batch
 * envelope for both pipelines (never per row on the wire - ingest denormalises
 * it onto rows so transports keep receiving bare record arrays).
 *
 * Keys follow OpenTelemetry Resource semantic conventions so a downstream
 * reader needs no translation table. This is the field readers should key on;
 * `source` / `app` stay for backward compatibility.
 */
export interface FroggerResource {
    'service.name'?: string
    'service.version'?: string
    /** `development` | `production` | whatever the deploy declares. */
    'deployment.environment'?: string
    /** Build/commit identity. Defaults to `service.version`. */
    'service.release'?: string
    /** Per-boot id for one server instance. Absent on the client. */
    'service.instance.id'?: string
    [key: string]: string | undefined
}

/**
 * Env overrides exist so one build can be promoted across environments without
 * a rebuild - which is the whole point of resolving these at boot rather than
 * baking them in.
 */
export const RESOURCE_ENV_KEYS = {
    environment: 'NUXT_FROGGER_ENVIRONMENT',
    release: 'NUXT_FROGGER_RELEASE',
    instanceId: 'NUXT_FROGGER_INSTANCE_ID',
} as const
