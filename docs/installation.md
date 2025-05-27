# Installation

To install the latest version of Frogger, navigate to your Nuxt project directory and run the following command:

::: code-group

```sh [pnpm]
$ pnpm add nuxt-frogger
```

```sh [npm]
$ npm install nuxt-frogger
```

```sh [yarn]
$ yarn add nuxt-frogger
```

```sh [bun]
$ bun add nuxt-frogger
```

:::

## Add to `nuxt.config.ts`
After installing, add `nuxt-frogger` to your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],
    frogger: {
        // Module options
    }
})
```


<!-- export interface ModuleOptions {
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
} -->

## Configuration
You can configure Frogger by adding options to the `frogger` property in your `nuxt.config.ts`. Here are the default options:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],
    frogger: {
        clientModule: true, // Enable the client module
        serverModule: true, // Enable the server module

        endpoint: '/api/_frogger/logs' // Override batch log ingestion endpoint

        file: {
            directory: 'logs', // Directory to store log files
            fileNameFormat: 'YYYY-MM-DD.log', // Format for log file names
            maxSize: 10 * 1024 * 1024, // Maximum size of log files
        },

        batch: {
            maxSize: 1000, // Maximum number of logs to batch
            maxAge: 60000, // Maximum age of logs in the batch
            retryOnFailure: true, // Retry sending logs on failure
            maxRetries: 3, // Maximum number of retries
            retryDelay: 5000 // Delay between retries
        },   
    }
})
```