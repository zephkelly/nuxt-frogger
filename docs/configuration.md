# Configuration
There are a few ways to configure Frogger: module options, environment variables, logger instance options, and runtime configuration.

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


### Frogger's Module Interface
Everything is optional, meaning what you don't configure will fallback to default values. Look in the sidebar to find more information about different options:
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

```ts
import { defineFroggerOptions } from '#frogger/config';

export default defineFroggerOptions({
    /* Configuration options go here! */
});
```


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
            route: DEFAULT_WEBSOCKET_ENDPOINT,
            defaultChannel: 'main',
            maxConcurrentQueries: 10,
            maxQueryResults: 1000,
            defaultQueryTimeout: 30000,
        },

        public: {
            endpoint: DEFAULT_LOGGING_ENDPOINT,
            
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



::: tip
If you set a `NUXT_PUBLIC_FROGGER_ENDPOINT` env variable in your production environment:

```
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
:::

## Frogger Config File
If you prefer to keep your Frogger configuration separate from your Nuxt configuration, you can create a `frogger.config.ts` file in the root of your project. This file will be automatically loaded by Frogger.

```ts
import { defineFroggerOptions } from '#frogger/config';

export default defineFroggerOptions({
    /* Configuration options go here! */
});
```