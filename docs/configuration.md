# Configuration
There are multiple way to configure Frogger. You can use the `frogger` key in your `nuxt.config.ts` file to adjust module options. You can create a separate `frogger.config.ts` configuration file in the root of your project, or you can use environment variables and runtime configuration to override settings in different environments.

::: info Hierarchy 
`frogger.config.ts` will always override `nuxt.config.ts`. Runtime config and env variables will always override both.
:::

## Module Options
The most common way to configure Frogger will be through it's module options. Use the `frogger` configuration key in your `nuxt.config.ts` file like so: 

```ts
export default defineNuxtConfig({
    frogger: {
        /* Configuration options go here! */
    }
})
```
Use this to set things like the location of your log files, the configuration of the log ingestion endpoint, batching options for client or server, and more.

### Module Interface

Everything is optional: what you don't configure falls back to a default. The
[Getting Started](./getting-started.md) guide covers the most common options.

::: info Generated
This block is generated from `src/runtime/shared/types/module-options.ts` by
`scripts/generate-config-docs.mjs`, so it cannot drift from the real type.
:::
<!-- GENERATED:module-options START -->
```ts
// Generated from src/runtime/shared/types/module-options.ts
// Run `node scripts/generate-config-docs.mjs` after changing that file.
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
```
<!-- GENERATED:module-options END -->

::: details Click here to view the full interface
```ts
export interface ModuleOptions {
    preset?: 'minimal' | 'standard' | 'full'

    clientModule?: boolean
    serverModule?: {
        autoEventCapture?: boolean
    } | boolean
    
    app?: {
        name: string;
        version?: string;
    } | string

    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
        flushInterval?: number
        bufferMaxSize?: number
        highWaterMark?: number
    }
    
    batch?: {
        // Records per exported batch. Reaching it schedules a flush.
        maxSize?: number
        // HARD ceiling on buffered records. Past it the oldest are dropped and
        // counted, rather than the buffer growing until the process dies.
        maxQueueSize?: number
        // Batches allowed to be in retry at once.
        maxConcurrentRetries?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
        sortingWindowMs?: number
    } | false

    consoleOutput?: boolean | {
        client?: boolean;
        server?: boolean;
    }

    rateLimit?: {
        // Which forwarding headers to believe when resolving the client
        // address. `false` (default) = socket peer only. Behind a proxy, set
        // `true`, a hop count, or a list of trusted peer addresses — otherwise
        // every request shares one bucket.
        trustProxy?: boolean | number | string[];

        limits?: {
            global?: number;
            perIp: number;
            perReporter?: number;
            perApp?: number;
        };
        
        windows?: {
            global?: number;
            perIp: number;
            perReporter?: number;
            perApp?: number;
        };
        
        blocking?: {
            enabled: boolean;
            escalationResetHours: number;
            finalBanHours: number;
            violationsBeforeBlock: number;
            timeouts: number[];
        };

        storage?: {
            driver?: string;
            options?: Record<string, any>;
        };
    } | boolean

    websocket?: {
        route: string;
        defaultChannel?: string;

        upgrade?: (request: Request) => boolean | Promise<boolean>;
    } | boolean

    scrub?: {
        maxDepth?: number;
        deepScrub?: boolean;
        preserveTypes?: boolean;
        rules?: ScrubRule[];
    } | boolean

    errorCapture?: boolean | {
        client?: {
            includeComponent?: boolean;
            includeComponentProps?: boolean;
            includeComponentOuterHTML?: boolean;
            includeInfo?: boolean;
            includeStack?: boolean;
        } | boolean;
        server?: {
            includeRequestContext?: boolean;
            // `true` sends every header except an unconditional deny-list
            // (cookie, authorization, x-api-key, ...); an array is an allow-list.
            includeHeaders?: boolean | string[];
            takeoverSignals?: boolean;
            exitOnUncaught?: boolean;
            drainTimeoutMs?: number;
            includeRejectionHandled?: boolean;
            includeWarnings?: boolean;
            includeStack?: boolean;
        } | boolean;
    }

    transports?: Array<{
        // Full ingest URL — shorthand for `baseUrl` (origin) + `endpoint` (path).
        url?: string
        baseUrl?: string
        endpoint?: string

        // Sent as the `x-api-key` header on every batch to this destination.
        apiKey?: string
        headers?: Record<string, string>

        client?: boolean   // fan out from the browser (default false)
        server?: boolean   // fan out from the server queue (default true)

        name?: string
        vendor?: string
        timeout?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
    }>

    public?: {
        endpoint?: string
        baseUrl?: string

        batch?: {
            maxSize?: number
            maxAge?: number
            retryOnFailure?: boolean
            maxRetries?: number
            retryDelay?: number
            sortingWindowMs?: number
        } | false
    }
}
```
:::

::: warning Client transport keys are public
A `client: true` transport's `apiKey` and `headers` are compiled into the
browser bundle. Only ever use a write-only, per-service, rate-limited ingest key
there. See [Transports → Security](/guides/transports#security-client-transport-keys-are-public).
:::

## Presets
Frogger is **quiet by default**. A bare install logs to the **console only** — nothing is written to disk and nothing is forwarded until you add a [transport](/guides/transports). The heavier subsystems are opt-in. A `preset` is a shorthand for a group of those toggles:

| Preset | scrub | rateLimit | errorCapture | websocket (dev live-stream) |
| --- | :---: | :---: | :---: | :---: |
| `minimal` *(default)* | ✗ | ✗ | ✗ | ✗ |
| `standard` | ✓ *(RECOMMENDED_RULES)* | ✓ | ✓ | ✗ |
| `full` | ✓ *(RECOMMENDED_RULES)* | ✓ | ✓ | ✓ |

`standard` and `full` seed the scrubber with [`RECOMMENDED_RULES`](/guides/scrubbing): passwords, secrets and tokens redacted; SSNs pseudonymised; card and account numbers masked; emails, phone numbers, names and addresses partially masked. A bare `scrub: true` deliberately injects **no** rules — enabling the scrubber and choosing a rule set are separate decisions, and the build warns when a scrubber resolves to zero rules.

Console output and client/server batching are always on unless you disable them explicitly (console output is turned off with [`consoleOutput`](#console-output)). `transports` and `metrics` are independent of the preset. Only the four columns above are preset-controlled.

```ts
export default defineNuxtConfig({
    // A production-sensible safety net: redaction, ingest rate-limiting and
    // global error capture, without the dev-only websocket live-stream.
    frogger: { preset: 'standard' }
})
```

Individual options **always win over the preset**, so you can start from a preset and flip one thing:

```ts
export default defineNuxtConfig({
    frogger: {
        preset: 'standard',
        scrub: false,        // turn one subsystem back off
        websocket: true,     // ...or add one the preset left off
    }
})
```

Each opt-in option accepts `true` (enable with sensible defaults), an object (enable and customise), or `false`/omitted (off). `errorCapture` additionally accepts `{ client, server }` so you can enable each side independently.

::: details Config applied when a subsystem is enabled
These are the defaults each subsystem uses once switched on (via a preset, `true`, or an object). Pass an object to override any field — it deep-merges onto these.
```ts
// scrub: true  →  engine on, but ZERO rules (nothing is scrubbed until you
// declare rules — see the Scrubbing guide). Only the knobs below are defaulted;
// maxDepth is unset = unlimited recursion:
{ deepScrub: true, preserveTypes: true }

// rateLimit: true  →
{
    trustProxy: false,
    limits:  { global: 10000, perIp: 100, perReporter: 50, perApp: 30 },
    windows: { global: 60, perIp: 60, perReporter: 60, perApp: 60 },
    blocking: {
        enabled: true,
        escalationResetHours: 24,
        timeouts: [60, 300, 1800],
        violationsBeforeBlock: 3,
        finalBanHours: 12,
    },
}

// websocket: true  →
{
    route: '/api/_frogger/dev-ws',
    defaultChannel: 'main',
}

// errorCapture: true  →
{
    client: {
        includeComponent: true,
        // Off by default: props routinely carry PII and tokens, and rendered
        // markup is rendered user data. See the 0.2.0 migration notes.
        includeComponentProps: false,
        includeComponentOuterHTML: false,
        includeInfo: true,
        includeStack: true,
    },
    server: {
        includeRequestContext: true,
        // Off by default: headers carry Cookie and Authorization.
        includeHeaders: false,
        // Frogger no longer owns host shutdown; Nitro's close hook drains.
        takeoverSignals: false,
        exitOnUncaught: false,
        drainTimeoutMs: 3000,
        includeRejectionHandled: false,
        includeWarnings: false,
        includeStack: true,
    },
}
```
:::

::: details Always-on core defaults (consoleOutput, file, batch)
```ts
// consoleOutput  →
{ client: true, server: true }

// file  →
{
    directory: 'logs',
    fileNameFormat: 'YYYY-MM-DD.log',
    maxSize: 10 * 1024 * 1024,
    flushInterval: 1000,
    bufferMaxSize: 1 * 1024 * 1024,
    highWaterMark: 64 * 1024,
}

// batch (server)  →
{ maxSize: 200, maxQueueSize: 2048, maxConcurrentRetries: 3, maxAge: 15000, retryOnFailure: true, maxRetries: 5, retryDelay: 10000, sortingWindowMs: 3000 }

// public.batch (client)  →
{ maxSize: 100, maxQueueSize: 1000, maxConcurrentRetries: 3, maxAge: 3000, retryOnFailure: true, maxRetries: 3, retryDelay: 3000, sortingWindowMs: 1000 }
```
:::

::: warning Upgrading from a version before presets
Earlier versions enabled scrubbing, rate-limiting, the dev websocket and global error capture **by default**. They are now off unless you opt in. To keep the old behaviour, set `preset: 'full'` (or `preset: 'standard'` to skip the dev-only websocket). The vestigial `public.globalErrorCapture` option has been removed — use `errorCapture` instead.

Note that scrubbing changed further: enabling it no longer applies any built-in rules. Even with `preset: 'full'`, nothing is scrubbed until you declare rules. To restore the old default coverage, opt into the `RECOMMENDED_RULES` bundle — see the [Scrubbing guide](/guides/scrubbing).
:::

## Console output
By default Frogger mirrors every application log to the console: the browser devtools console on the client, stdout on the server. `consoleOutput` turns that off.

```ts
export default defineNuxtConfig({
    frogger: {
        consoleOutput: false,   // silence both runtimes
    }
})
```

Pass an object to control each runtime independently. The most common case is a silent browser with the server console left intact:

```ts
export default defineNuxtConfig({
    frogger: {
        consoleOutput: {
            client: process.env.NODE_ENV !== 'production',
            // `server` is unspecified, so it stays on
        },
    }
})
```

`client` covers loggers created by `useFrogger()` and the ambient `frogger.*` facade, including the logs they emit during server-side rendering. `server` covers `getFrogger()`.

::: tip Silencing the console never drops a log
Console output and transport delivery are independent paths. A logger with `consoleOutput: false` still batches every log and ships it to your configured [transports](/guides/transports) and ingest endpoint. This is what makes it safe to run a production browser build that prints nothing to devtools while still collecting everything.
:::

### Per-logger overrides
`consoleOutput` is also a [per-instance option](/reference/logger-api#per-instance-options). A value passed to a specific logger always wins over the module option, in **either** direction:

```ts
// with nuxt.config.ts set to frogger: { consoleOutput: false }

frogger.info('silent')                              // module default: no console
useFrogger().info('silent')                         // module default: no console
useFrogger({ consoleOutput: true }).info('loud')    // opts back in
```

Resolution order, most specific first:

| Source | Example |
| --- | --- |
| Per-logger option | `useFrogger({ consoleOutput: true })` |
| Module option | `frogger: { consoleOutput: { client: false } }` |
| Built-in default | `true` |

Child loggers and spans inherit their parent's resolved value, so `logger.child({})`, `logger.startSpan('checkout')` and `logger.span('checkout', fn)` all stay consistent with the logger they came from.

::: warning Not the same as `verbose` / `logLevel`
`consoleOutput` governs **your** application logs. Frogger's own internal diagnostics (transport state, caught errors in its machinery, build banners) are a separate channel, controlled by the `verbose` and `logLevel` module options. Those are already silent in production builds.

One console message is deliberately exempt from both: if a log fails to reach the queue *and* a direct send also fails, Frogger prints an error rather than dropping your log silently.
:::

## Frogger Config
If you prefer to keep your Frogger configuration separate from your Nuxt configuration, you can create a `frogger.config.ts` file in the root of your project. It will be automatically scanned by Frogger.

```ts
import { defineFroggerOptions } from '#frogger/config';

export default defineFroggerOptions({
    /* Configuration options go here! */
});
```

## Env Variables
All of Frogger's module options are stored in Nuxt's runtime configuration. Everything is overridable, meaning zero changes required if you need different settings in different environments. 

For example, if you set a `NUXT_PUBLIC_FROGGER_ENDPOINT` env variable in your production environment:

``` env
NUXT_PUBLIC_FROGGER_ENDPOINT=https://my-custom-endpoint.com
```

It will behave the same as overriding the `public.endpoint` option in the module configuration:

```ts
export default defineNuxtConfig({
    frogger: {
        public: {
            endpoint: '/api/_frogger/logs', // [!code focus] [!code --]
            endpoint: 'https://my-custom-endpoint.com' // [!code focus] [!code ++] 
        }
    }
})
```

Nested keys follow the same pattern, so console output can be silenced per runtime without touching your config:

``` env
NUXT_PUBLIC_FROGGER_CONSOLE_OUTPUT_CLIENT=false
```

::: warning
Changing Frogger's options during the runtime of your applications is **not** recommended. It won't work. Frogger internals capture configuration options at build time, and wont react to changes. Configuration options should only be set at the starting of your application or at build time.
:::

::: tip
If you need something more dynamic, [logger instances](./getting-started.md#loggers) are designed to be pluggable, extendable, and configurable at runtime.
:::

## Environment variables

Three `NUXT_FROGGER_*` variables are read at **boot**, not at build. That is the
point: one build can be promoted across environments without a rebuild.

| Variable | Sets | Notes |
| --- | --- | --- |
| `NUXT_FROGGER_ENVIRONMENT` | `resource['deployment.environment']` | Overrides the `environment` option. Defaults to `development` in dev, `production` otherwise |
| `NUXT_FROGGER_RELEASE` | `resource['service.release']` | A commit SHA or build id. Defaults to `app.version` |
| `NUXT_FROGGER_INSTANCE_ID` | `resource['service.instance.id']` | Server only. A fresh uuidv7 per boot when unset — which is what makes two instances behind a load balancer distinguishable |
| `NUXT_FROGGER_SCRUB_SALT` | The scrubber's hash salt | So pseudonymised tokens are not comparable across unrelated deployments |

## Options that are easy to miss

### `public.endpoint: false`

Disables the browser's POST to your own ingest route while **leaving the server
route registered**. Client logs then reach `client: true` transports only.

Useful when the browser ships directly to a remote collector and your server
should not be in that path.

### `apiKeyLocation`

Where a transport's `apiKey` is sent:

- `'header'` (default) — `x-api-key`.
- `'query'` — `?key=` on the request URL.

Query auth exists for ingest APIs whose CORS design expects a bare browser
`fetch` with no custom headers, and it is the **only** auth a `sendBeacon`
page-exit send can carry, since a beacon cannot set headers.

### `maxBatchEvents` / `maxBodyBytes`

Per-destination caps that split an outgoing batch into chunks. Set
automatically for `observeTransport()` (500 events, ~950 KiB) to match that
ingest's limits; set them yourself for a destination with its own.

### The `frogger:init` hook

For context only known at runtime — a tenant, a deployment region — tap the hook
from a client plugin rather than putting it in `context`, which is serialised at
build time:

```ts
// plugins/frogger-context.ts
export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.hook('frogger:init', (logger) => {
        logger.addContext({ tenant: resolveTenant() })
    })
})
```

Hook context merges on top of the static `context` option.

### `getFroggerHealth()`

Auto-imported on both runtimes. Returns what this process has enqueued,
delivered and dropped, and why:

```ts
const { enqueued, delivered, dropped, lastError } = getFroggerHealth()
// dropped: { overflow, rateLimited, rejected4xx, retriesExhausted, pipelineError }
```

The first drop of a process always prints, whatever the internal log level —
a misconfigured ingest key discarding every log in production must not be
silent. Subsequent drops are counted here rather than repeated.
