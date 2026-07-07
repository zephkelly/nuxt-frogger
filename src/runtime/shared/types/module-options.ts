import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";
import type { RateLimitingOptions } from "../../rate-limiter/types";
import type { AppInfoOptions } from "../../app-info/types";
import type { WebsocketOptions } from "../../websocket/types/options";
import type { ScrubberOptions } from "../../scrubber/options";
import type { GlobalErrorCaptureOptions } from "./global-error";
import type { InternalLogLevel } from "../utils/internal-log";


/**
 * Shorthand that expands to a set of subsystem toggles. See
 * {@link https://github.com/zephkelly/nuxt-frogger | the docs} / `resolve-options.ts`.
 *
 * - `minimal` — file + console only (the bare-install default). Scrubbing,
 *   rate-limiting, the dev websocket live-stream and global error capture are
 *   all off.
 * - `standard` — adds scrubbing, ingest rate-limiting and global error capture
 *   (the dev websocket live-stream stays off).
 * - `full` — everything on, including the dev websocket live-stream.
 *
 * Individual options always override the preset.
 *
 * @default 'minimal'
 */
export type FroggerPreset = 'minimal' | 'standard' | 'full'


export interface ModuleOptions {
    /**
     * Subsystem preset. A shorthand that turns groups of opt-in subsystems on
     * or off; individual options below still win over it.
     *
     * @default 'minimal'
     */
    preset?: FroggerPreset

    clientModule?: boolean
    serverModule?: {
        autoEventCapture?: boolean
    } | boolean

    /**
     * Controls Frogger's own internal diagnostic output — NOT your application
     * logs. Shorthand for {@link ModuleOptions.logLevel}: `true` maps to
     * `'debug'` (everything), `false` to `'silent'`. Ignored when `logLevel`
     * is set explicitly.
     *
     * @default false in production, warnings-and-up in development
     */
    verbose?: boolean

    /**
     * Threshold for Frogger's own internal diagnostics (transport state,
     * websocket bookkeeping, caught errors in its machinery, build banners).
     * Does not affect your application logs. Takes precedence over `verbose`.
     *
     * @default 'silent' in production, 'warn' in development
     */
    logLevel?: InternalLogLevel

    app?: AppInfoOptions,

    file?: FileOptions

    batch?: BatchOptions | false

    /**
     * Ingest-endpoint rate limiting. Off by default; `true` enables it with
     * sensible tiers, or pass an object to tune limits/windows/blocking.
     */
    rateLimit?: RateLimitingOptions | boolean

    /**
     * Dev-only websocket live-stream of logs. Off by default; `true` enables it
     * on the default route, or pass an object to customise.
     */
    websocket?: WebsocketOptions | boolean

    /**
     * Sensitive-data scrubbing (redaction) of log context. Off by default;
     * `true` enables the built-in rules, or pass an object to extend them.
     */
    scrub?: ScrubberOptions | boolean

    /**
     * Global error capture (client Vue handler + server process/Nitro hooks).
     * Off by default. `true` enables both sides; pass an object to enable or
     * tune each side independently (`{ client: true, server: false }`).
     */
    errorCapture?: boolean | {
        client?: GlobalErrorCaptureOptions['client'] | boolean
        server?: GlobalErrorCaptureOptions['server'] | boolean
    }

    public?: {
        endpoint?: string
        baseUrl?: string

        batch?: BatchOptions | false

        serverModule?: boolean
    }
}

export const APP_MOUNTED_STATE_KEY = 'frogger-app-mounted-state';

export const DEFAULT_LOGGING_ENDPOINT = '/api/_frogger/logs';

export const DEFAULT_WEBSOCKET_ENDPOINT = '/api/_frogger/dev-ws';