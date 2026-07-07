# Error Capture

Frogger can install global error handlers on both the client and the server, so uncaught errors are
logged automatically — with component info, request context, and stack traces folded into
`ctx`. This is **opt-in**: enable it with `errorCapture`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    frogger: { errorCapture: true }     // or { client: true, server: false } / preset: 'standard' / 'full'
})
```

You can enable the client and server sides independently by passing a `{ client, server }` object
(see [Configuration](#configuration) below). It's also bundled into the `standard` and `full`
[presets](../configuration.md#presets).

## On the client

Frogger hooks Vue's global `errorHandler`, which catches errors thrown in **render functions,
lifecycle hooks, watchers, and event handlers**. Each one is logged at `error` level:

```ts
// Automatically logged when this throws:
function onClick() {
    throw new Error('Boom') // → logger.error('Boom', { component, info, stack, uncaught: true })
}
```

The context attached depends on your config:

```ts
errorCapture: {
    client: {
        includeComponent?: boolean         // component name — default true
        includeComponentProps?: boolean    // the component's props — default true
        includeComponentOuterHTML?: boolean // the component's rendered HTML — default true
        includeInfo?: boolean              // Vue's error info string — default true
        includeStack?: boolean             // the error stack — default true
    }
}
```

::: warning Not every error
Vue's handler does **not** see raw `window` errors or unhandled promise rejections that happen
outside Vue's reactivity (e.g. a bare `Promise.reject()` with no `await`). For those, log
explicitly with `frogger.error(...)`.
:::

## On the server

In Nitro, Frogger hooks several sources:

| Source | Logged as | Notes |
| --- | --- | --- |
| `nitroApp.hooks('error')` | `error` | Uncaught errors thrown from route handlers, with request context |
| `process` `uncaughtException` | `fatal` | The process then exits |
| `process` `unhandledRejection` | `error` | Rejected promises with no handler |
| `process` `rejectionHandled` | `warn` | Only if `includeRejectionHandled` |
| `process` `warning` | `warn` | Only if `includeWarnings` |

```ts
errorCapture: {
    server: {
        includeRequestContext?: boolean    // method + url of the failing request — default true
        includeHeaders?: boolean           // request headers — default true
        includeRejectionHandled?: boolean  // log late-handled rejections — default false
        includeWarnings?: boolean          // log process warnings — default false
        includeStack?: boolean             // the error stack — default true
    }
}
```

Once enabled, a route that throws is captured automatically:

```ts
export default defineEventHandler(() => {
    throw new Error('something broke') // → Frogger logs it via the Nitro error hook
})
```

## Configuration

`errorCapture` is off by default. Pass `true` to enable both sides with sensible defaults, a
boolean per side via `{ client, server }`, or a full object to customise:

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
    errorCapture: {
        client: { includeComponentProps: false }, // trim noisy props from client error logs
        server: { includeHeaders: false },         // don't log request headers
    },
})
```

```ts
// explicitly disable all automatic error capture (this is also the default)
export default defineFroggerOptions({
    errorCapture: false,
})
```

::: tip Errors in your own logs
When you pass an `Error` to a log call (or to the ambient `frogger`), Frogger lifts it into
`ctx.error` with its `name`, `message`, and `stack` automatically — so
`logger.error('checkout failed', { error })` and `frogger.error('checkout failed', err)` both
preserve the stack. See [Getting Started](/getting-started#ctx).
:::
