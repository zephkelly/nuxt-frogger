# Configuration
There are many ways to configure Frogger. Global configuration happens in `nuxt.config.ts`, local configurations can be set on each logger instance, and you can also use runtime configuration variables (`NUXT_FROGGER_`) to override options at runtime and in different environments.

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
This is the full interface for Frogger's module options. Everything is optional, so what you don't configure will fallback to default values:
```ts
export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean

    endpoint?: string

    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
    }

    batch?: {
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
    }
}
```

::: details Click here to view Frogger's default module options
```ts
export default defineNuxtModule<ModuleOptions>({
    defaults: {
        clientModule: true,
        serverModule: true,

        endpoint: '/api/_frogger/logs',

        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
        },

        batch: {
            maxSize: 100,
            maxAge: 60000,
            retryOnFailure: true,
            maxRetries: 3,
            retryDelay: 5000,
        },
    }
})
```
:::


::: warning
Frogger's module options ***will be overridden*** at runtime by configuration variables. This is useful for setting different configurations in development and production environments but may lead to unexpected behavior for those unaware.

For example, if you set `NUXT_FROGGER_ENDPOINT` in your .env file:

```
# .env
NUXT_FROGGER_ENDPOINT=https://my-custom-endpoint.com
```

It will behave the same as overriding the `endpoint` option in the module configuration:

```ts
export default defineNuxtConfig({
    frogger: {
        endpoint: '/api/_frogger/logs', // [!code focus] [!code --]
        endpoint: 'https://my-custom-endpoint.com' // [!code focus] [!code ++]
    }
})
```
:::