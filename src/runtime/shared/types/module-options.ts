import type { LogType } from "consola"
import type { BatchOptions } from "./batch"
import type { RateLimitingOptions } from "../../rate-limiter/types";
import type { AppInfoOptions } from "../../app-info/types";
import type { WebsocketOptions } from "../../websocket/types/options";
import type { ScrubberOptions } from "../../scrubber/options";
import type { GlobalErrorCaptureOptions } from "./global-error";
import type { InternalLogLevel } from "../utils/internal-log";
import type { FroggerTransportConfig } from "./transports";
import type { LogContext } from "./log";
import type { MetricsOptions } from "../../metrics/shared/types/metric-options";
import type { SamplingOptions } from "../utils/sampling";

export type {
    FroggerTransportConfig,
    HttpTransportConfig,
    FileTransportConfig,
    ObserveTransportConfig,
    ResolvedHttpTransport,
    ResolvedFileTransport,
    ResolvedServerTransport,
} from "./transports";


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

    /**
     * Mirrors your application logs to the console. On for both runtimes by
     * default. This is the counterpart to `verbose`/`logLevel`, which govern
     * Frogger's own diagnostics rather than your logs.
     *
     * `false` silences both sides; pass an object to control each independently
     * (`{ client: false }` leaves the server console untouched). `client`
     * covers loggers created by `useFrogger()` and the ambient `frogger.*`
     * facade — including their output during SSR — while `server` covers
     * `getFrogger()`.
     *
     * Transport delivery is a wholly separate path, so a silenced console still
     * batches and ships every log. A per-logger `consoleOutput` still overrides
     * whatever is set here, in either direction.
     *
     * @default true
     */
    consoleOutput?: boolean | {
        client?: boolean
        server?: boolean
    }

    app?: AppInfoOptions,

    /**
     * Threshold for YOUR application logs. A level NAME, not a number:
     * `'info'` (the default) admits info and everything more important;
     * `'debug'` additionally admits `frogger.debug()`; `'trace'` admits
     * everything.
     *
     * Without this, `frogger.debug()` and `frogger.trace()` were process-wide
     * no-ops with no documented way to enable them.
     *
     * Pass an object to set each runtime independently - `{ server: 'debug' }`
     * is the usual shape, since server volume is cheap and client volume is
     * bandwidth. A per-logger `useFrogger({ level })` still overrides this.
     *
     * Not to be confused with {@link logLevel}, which governs Frogger's own
     * internal diagnostics.
     *
     * @default 'info'
     */
    level?: LogType | { client?: LogType, server?: LogType }

    /**
     * Deployment environment stamped on every batch as
     * `resource['deployment.environment']`. Without it, staging and production
     * rows shipped to the same sink are indistinguishable.
     *
     * Falls back to `$NUXT_FROGGER_ENVIRONMENT`, then to `development` in dev
     * and `production` otherwise. Prefer the env var over this option when one
     * build is promoted across environments.
     *
     * @default 'development' in dev, 'production' otherwise
     */
    environment?: string

    /**
     * Base context stamped onto every ambient `frogger.*` log at boot, without
     * needing a plugin. Use it for static, build-time-known fields shared by all
     * logs (service name, region, build/version metadata).
     *
     * Because `frogger.config.ts` is evaluated at build time and serialized into
     * runtime config, this must be a plain, serializable object — no functions.
     * For values only known at runtime (per-session tenant, per-deployment env),
     * register a client plugin that taps the `frogger:init` hook and calls
     * `frogger.addContext(...)`; hook context merges on top of this.
     *
     * @default undefined
     */
    context?: LogContext

    batch?: BatchOptions | false

    /**
     * Attach W3C trace headers to outbound `$fetch` calls from the browser, so
     * a click and the server work it triggers land on one trace.
     *
     * SAME-ORIGIN ONLY by default, and that default is the safety property: a
     * naive global patch leaks internal trace ids to every third-party endpoint
     * the page calls. Pass `{ urls: [...] }` to allow specific extra
     * destinations, or `false` to disable it.
     *
     * A RegExp matcher MUST be anchored - `/api\.example\.com/` also matches
     * `https://evil.test/?x=api.example.com`.
     *
     * Opt out per call with `$fetch(url, { frogger: false })`.
     *
     * @default same-origin only
     */
    tracePropagation?: false | {
        urls?: (string | RegExp | ((url: string) => boolean))[]
    }

    /**
     * Span-end events. Every `span()` emits one row carrying its duration and
     * ok/error status (OTel-style), so a span is visible even when nothing
     * logs inside it. On by default at `info`; pass `{ level }` to change the
     * level or `false` to make spans pure correlation scopes again.
     *
     * `metric: true` additionally records a `span.duration` histogram per span,
     * which is how existing span call sites become latency data without a
     * single call-site edit. To get the histogram WITHOUT the log volume, pin
     * the level below the logger's own (`{ level: 'debug', metric: true }`):
     * the row is filtered before any transport, the metric is not.
     *
     * @default { level: 'info', metric: false }
     */
    spans?: boolean | { level?: LogType, metric?: boolean }

    /**
     * Trace sampling: keep a fraction of traces, always keeping the ones that
     * matter.
     *
     * Distinct from {@link level}, which is a hard severity threshold.
     * Collapsing the two either loses errors under heavy sampling or fails to
     * control cost at all.
     *
     * The decision is made once per trace and derived from a hash of the trace
     * id, NOT from a fresh random draw - so a client/server hop samples
     * identically on both sides. Without that, a meaningful fraction of traces
     * come out half-present, which reads as a dropped request.
     *
     * Errors, failed spans and `ctx.forceKeep` are always kept.
     *
     * @default { rate: 1 } (no sampling)
     */
    sampling?: SamplingOptions

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

    /**
     * Log destinations. Each entry is a tagged transport config, most easily
     * built with the `fileTransport()`, `httpTransport()` and
     * `observeTransport()` factories. HTTP/observe entries fan out from the
     * server queue (`server`, default on) and/or the browser (`client`, default
     * off); file entries are server-only. A bare install has no transports and
     * logs to console only. Independent of `preset`.
     *
     * @default []
     */
    transports?: FroggerTransportConfig[]

    /**
     * Metrics subsystem. A fully separate, opt-in capability from logging: OFF
     * by default and never part of a `preset`. `true` auto-collects Web Vitals
     * + a per-batch device envelope; pass an object to tune sampling, batching
     * and metric transports. See {@link MetricsOptions}.
     *
     * @default false
     */
    metrics?: MetricsOptions | boolean

    public?: {
        /**
         * The app's own ingest route the browser POSTs to. `false` disables the
         * client POST entirely (client logs then only reach `client:true`
         * transports); the server route stays registered.
         */
        endpoint?: string | false
        baseUrl?: string

        batch?: BatchOptions | false
    }
}

export const APP_MOUNTED_STATE_KEY = 'frogger-app-mounted-state';

export const DEFAULT_LOGGING_ENDPOINT = '/api/_frogger/logs';

export const DEFAULT_WEBSOCKET_ENDPOINT = '/api/_frogger/dev-ws';

export const DEFAULT_METRICS_ENDPOINT = '/api/_frogger/metrics';