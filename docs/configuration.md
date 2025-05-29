# Configuration
There are a few ways to configure Frogger. Global configuration happens in `nuxt.config.ts`, and local configuration can be set on each logger instance.


## Module Options
To configure Frogger globally, you can use the `frogger` configuration key in your `nuxt.config.ts` file: 

```ts
export default defineNuxtConfig({
    frogger: {
        /* Configuration options go here! */
    }
})
```
Use this to set things like the location of your log files, the configuration of the log ingestion endpoint, batching options for client or server, and more.

## Frogger's Module Interface
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