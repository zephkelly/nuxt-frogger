# Configuring Frogger
There are several ways to configure Frogger to fit the needs of your Nuxt application. Global configuration options can be set in your `nuxt.config.ts` file, while each logger instance
also supports its own configuration options.

::: details Trying to add context to your logs?

:::

::: details Trying to configure tracing?

:::


## Module Options
This is the interface for Frogger's global module-level options. These are set in your `nuxt.config.ts` file under the `frogger` key.

```ts
export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean

    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
        format?: 'json' | 'text'
    }
    batch?: {
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
    } | boolean
    endpoint: string
}
```

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],
    frogger: { /* Configuration options go here! */ }
})
```


::: details View Frogger's default configuration
```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],
    frogger: {
        clientModule: true,
        serverModule: true,

        endpoint: '/api/_frogger/logs' // Override batch log ingestion endpoint

        file: {
            maxSize: 10 * 1024 * 1024, // Maximum size of log files
            directory: 'logs', // Directory to store log files relative to project root
            fileNameFormat: 'YYYY-MM-DD.log',
        },

        batch: {
            maxSize: 1000, // Maximum number of logs to batch
            maxAge: 60000, // Maximum age of logs in the batch
            retryOnFailure: true,
            maxRetries: 3,
            retryDelay: 5000
        },   
    }
})
```
:::
