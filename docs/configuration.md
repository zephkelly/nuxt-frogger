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
    clientModule?: boolean
    serverModule?: {
        autoEventCapture?: boolean
    } | boolean
    
    app?: AppInfoOptions,

    file?: FileOptions
    
    batch?: BatchOptions | false

    rateLimit?: RateLimitingOptions | false

    websocket?: WebsocketOptions | boolean

    scrub?: ScrubberOptions | boolean
    
    public?: {
        endpoint?: string
        baseUrl?: string
        
        batch?: BatchOptions | false

        globalErrorCapture?: {
            includeComponent?: boolean
            includeComponentOuterHTML?: boolean
            includeComponentProps?: boolean
            includeStack?: boolean
            includeInfo?: boolean
        } | boolean

        serverModule?: boolean
    }
}
```

::: details Click here to view the full interface
```ts
export interface ModuleOptions {
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
    } | false

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

        globalErrorCapture?: {
            includeComponent?: boolean
            includeComponentOuterHTML?: boolean
            includeComponentProps?: boolean
            includeStack?: boolean
            includeInfo?: boolean
        } | boolean
    }
}
```
:::

::: details Click here to view all default values
```ts
export default defineNuxtModule<ModuleOptions>({
    defaults: {
        clientModule: true,
        serverModule: {
            autoEventCapture: true
        },

        app: 'nuxt-frogger',
        
        batch: {
            maxSize: 200,
            maxAge: 15000,
            retryOnFailure: true,
            maxRetries: 5,
            retryDelay: 10000,
            sortingWindowMs: 3000,
        },
        
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            flushInterval: 1000,
            bufferMaxSize: 1 * 1024 * 1024,
            highWaterMark: 64 * 1024,
        },
        
        rateLimit: {      
            storage: {
                driver: undefined,
                options: {}
            },

            limits: {
                global: 10000,
                perIp: 100,
                perReporter: 50,
                perApp: 30
            },
            
            windows: {
                global: 60,
                perIp: 60,
                perReporter: 60,
                perApp: 60
            },
            
            blocking: {
                enabled: true,
                escalationResetHours: 24,
                timeouts: [60, 300, 1800],
                violationsBeforeBlock: 3,
                finalBanHours: 12
            },
        },

        scrub: {
            maxDepth: 10,
            deepScrub: true,
            preserveTypes: true,
        },

        websocket: {
            route: '/api/_frogger/dev-ws',
            defaultChannel: 'main',
            maxConcurrentQueries: 10,
            maxQueryResults: 1000,
            defaultQueryTimeout: 30000,
        },

        public: {
            endpoint: '/api/_frogger/logs',
            
            globalErrorCapture: {
                includeComponent: true,
                includeComponentProps: false,
                includeComponentOuterHTML: true,
                includeStack: true,
                includeInfo: true
            },


            batch: {
                maxAge: 3000,
                maxSize: 100,
                retryOnFailure: true,
                maxRetries: 3,
                retryDelay: 3000,
                sortingWindowMs: 1000,
            },
        }
    }
})
```
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