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
Everything is optional, meaning what you don't configure will fallback to default values. The [Getting Started](./getting-started.md) guide will get you familiar with the most common options:
```ts
export interface ModuleOptions {
    // Subsystem preset — see "Presets" below. Default: 'minimal'.
    preset?: 'minimal' | 'standard' | 'full'

    clientModule?: boolean
    serverModule?: {
        autoEventCapture?: boolean
    } | boolean
    
    app?: AppInfoOptions,

    file?: FileOptions
    
    batch?: BatchOptions | false

    // Opt-in. `true` enables sensible tiers; an object tunes them.
    rateLimit?: RateLimitingOptions | boolean

    // Opt-in. `true` enables the dev live-stream on the default route.
    websocket?: WebsocketOptions | boolean

    // Opt-in. `true` enables the built-in redaction rules.
    scrub?: ScrubberOptions | boolean

    // Opt-in. `true` enables both sides; enable/tune each independently with
    // `{ client, server }`.
    errorCapture?: boolean | {
        client?: ClientErrorCaptureOptions | boolean
        server?: ServerErrorCaptureOptions | boolean
    }

    // Extra log destinations. Each forwards every batch to an HTTP ingest URL,
    // from the server queue (`server`, default on) and/or the browser
    // (`client`, default off). See the Transports guide. Default: [].
    transports?: HttpTransportConfig[]

    public?: {
        endpoint?: string
        baseUrl?: string
        
        batch?: BatchOptions | false

        serverModule?: boolean
    }
}
```

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
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
        sortingWindowMs?: number
    } | false

    rateLimit?: {
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

        maxConcurrentQueries?: number;
        defaultQueryTimeout?: number;
        maxQueryResults?: number;

        cache?: {
            maxMemoryMB?: number;
            ttlSeconds?: number;
            maxEntries?: number;
            enabled?: boolean;
        }
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
            includeHeaders?: boolean;
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
Frogger is **quiet by default**. A bare install logs to a file and the console, and nothing else — the heavier subsystems are opt-in. A `preset` is a shorthand for a group of those toggles:

| Preset | scrub | rateLimit | errorCapture | websocket (dev live-stream) |
| --- | :---: | :---: | :---: | :---: |
| `minimal` *(default)* | ✗ | ✗ | ✗ | ✗ |
| `standard` | ✓ | ✓ | ✓ | ✗ |
| `full` | ✓ | ✓ | ✓ | ✓ |

`file` + `console` output and client/server batching are always on (unless you disable them explicitly). Only the four columns above are preset-controlled.

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
// scrub: true  →
{ maxDepth: 10, deepScrub: true, preserveTypes: true }

// rateLimit: true  →
{
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
    maxConcurrentQueries: 10,
    maxQueryResults: 1000,
    defaultQueryTimeout: 30000,
}

// errorCapture: true  →
{
    client: {
        includeComponent: true,
        includeComponentProps: true,
        includeComponentOuterHTML: true,
        includeInfo: true,
        includeStack: true,
    },
    server: {
        includeRequestContext: true,
        includeHeaders: true,
        includeRejectionHandled: false,
        includeWarnings: false,
        includeStack: true,
    },
}
```
:::

::: details Always-on core defaults (file, batch)
```ts
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
{ maxSize: 200, maxAge: 15000, retryOnFailure: true, maxRetries: 5, retryDelay: 10000, sortingWindowMs: 3000 }

// public.batch (client)  →
{ maxSize: 100, maxAge: 3000, retryOnFailure: true, maxRetries: 3, retryDelay: 3000, sortingWindowMs: 1000 }
```
:::

::: warning Upgrading from a version before presets
Earlier versions enabled scrubbing, rate-limiting, the dev websocket and global error capture **by default**. They are now off unless you opt in. To keep the old behaviour, set `preset: 'full'` (or `preset: 'standard'` to skip the dev-only websocket). The vestigial `public.globalErrorCapture` option has been removed — use `errorCapture` instead.
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

::: warning
Changing Frogger's options during the runtime of your applications is **not** recommended. It won't work. Frogger internals capture configuration options at build time, and wont react to changes. Configuration options should only be set at the starting of your application or at build time.
:::

::: tip
If you need something more dynamic, [logger instances](./getting-started.md#loggers) are designed to be pluggable, extendable, and configurable at runtime.
:::
