# Transports

Once a log reaches the server it's handed to zero or more **transports** — the things that
actually persist or forward it.

::: warning A bare install writes no files
Frogger is quiet by default: with no `transports` configured, logs reach the **console only**.
Nothing is written to disk and nothing is forwarded. Persistence is always something you ask
for, by adding an entry to `transports`.
:::

```ts
// frogger.config.ts
import { defineFroggerOptions, fileTransport } from '#frogger/config'

export default defineFroggerOptions({
    transports: [
        fileTransport(),
    ],
})
```

## Choosing a transport

| Factory | Where it writes | Use it when |
| --- | --- | --- |
| `fileTransport()` | Rotated JSON-lines on the server's disk | You run on a long-lived Node process with a writable filesystem |
| `stdoutTransport()` | JSON-lines to fd 1 | Anywhere — including edge and serverless. Every platform's log collector already reads stdout |
| `httpTransport()` | Any HTTP ingest endpoint | You have a log backend of your own, or want OTLP |
| `observeTransport()` | A nuxt-observe deployment | You use nuxt-observe |
| `memoryTransport()` | An in-process array | Tests |

::: tip No writable disk?
`fileTransport()` needs a long-lived process and a writable filesystem. On an edge or serverless
preset the build **fails** with a message pointing here, rather than failing at the first write.
Use `stdoutTransport()` or `httpTransport()` there.
:::

## File transport

`fileTransport()` appends each log as a line of JSON to a rotated file:

```bash
logs/2026-06-26.log     # one JSON object per line (JSON-lines)
```

- **Date rotation** — a new file per day, named by `fileNameFormat` (default `YYYY-MM-DD.log`).
- **Size rotation** — when a file passes `maxSize` (default 10 MB) it's rotated aside.
- **Buffered writes** — logs are buffered and flushed on an interval for throughput, controlled
  by `flushInterval`, `bufferMaxSize`, and `highWaterMark`.

```ts
// frogger.config.ts
import { defineFroggerOptions, fileTransport } from '#frogger/config'

export default defineFroggerOptions({
    transports: [
        fileTransport({
            directory: 'logs',            // where files are written
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,    // 10 MB
            flushInterval: 1000,          // ms
            bufferMaxSize: 1 * 1024 * 1024,
            highWaterMark: 64 * 1024,
        }),
    ],
})
```

If the filesystem refuses writes (disk full, read-only mount, no permission), the transport
**degrades**: it stops buffering, prints one unconditional error, and the rest of your pipeline
carries on. It never grows a buffer that can no longer drain.

## Stdout transport

```ts
transports: [stdoutTransport()]
```

JSON-lines to file descriptor 1. No configuration, no infrastructure, and it works on every
Nitro preset including edge. Vector, Fluent Bit, Promtail, Docker and every hosting platform's
own log view already read stdout.

This is a different thing from `consoleOutput`, which is human-formatted output for a developer
watching a terminal. This is machine-readable output for a collector.

## Per-destination levels

Every transport accepts `minLevel`, a severity threshold for that destination alone:

```ts
transports: [
    fileTransport(),                                  // everything
    httpTransport({ url: '...', minLevel: 'warn' }),  // warn and above only
]
```

This composes with the module-wide `level`: the logger decides what a record even is, and each
destination decides what it wants.

::: info Reading logs in production
There is no built-in query API or viewer for production — logs are plain JSON-lines files on
disk. Read them with whatever you like (`tail -f`, `jq`, ship them to a log aggregator, etc.).
The live [WebSocket stream](/guides/live-logs) is a **development-only** convenience.
:::

## Reporters — fan out from a logger

A **reporter** is anything with a `log(entry)` method. Add one to a logger and it receives every
[`LoggerObject`](/reference/logger-api#loggerobject) that logger produces — handy for sending a
copy somewhere custom.

```ts
export interface IFroggerReporter {
    log: (entry: LoggerObject) => void | Promise<void>
}
```

```ts
const logger = useFrogger()

logger.addReporter({
    log(entry) {
        // entry is the full LoggerObject (already scrubbed)
        if (entry.lvl <= 1) {
            myAlertService.notify(entry.msg, entry.ctx)
        }
    },
})

// later
logger.clearReporters() // or removeReporter(reporter)
```

The logger contract exposes `addReporter` / `removeReporter` / `getReporters` / `clearReporters`
— see the [Logger API reference](/reference/logger-api).

## `HttpTransport` — forward to an external endpoint

`HttpTransport` is a prebuilt, server-side transport (auto-imported in Nitro) that posts logs to
an HTTP endpoint as a batch, with timeouts, retry/backoff, and W3C trace headers. Use it to
forward logs to an external collector or a second Frogger server.

```ts
const transport = new HttpTransport({
    endpoint: '/ingest',                  // required
    baseUrl: 'https://logs.example.com',  // defaults to your app baseUrl
    vendor: 'my-app',
    apiKey: process.env.LOGS_KEY,         // → sent as `x-api-key` on every batch
    headers: { 'x-tenant': 'acme' },      // merged onto every request
    timeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 1000,
    appInfo: { name: 'my-api', version: '1.0.0' },
})

await transport.logBatch(logs) // logs: LoggerObject[]
await transport.destroy()      // flush + clean up when done
```

### Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `endpoint` | `string` | — | **Required.** Path to POST batches to |
| `baseUrl` | `string` | app baseUrl | Prepended to `endpoint` |
| `vendor` | `string` | `'frogger'` | Vendor name used in trace headers |
| `apiKey` | `string` | — | Sent as the `x-api-key` header on every batch. Frogger's one auth header |
| `headers` | `Record<string, string>` | `{}` | Extra request headers, merged onto each request |
| `timeout` | `number` | `30000` | Per-request timeout (ms) |
| `retryOnFailure` | `boolean` | `true` | Retry failed sends |
| `maxRetries` | `number` | `3` | Max retry attempts |
| `retryDelay` | `number` | `1000` | Base delay (ms); backoff is exponential |
| `appInfo` | `{ name, version? }` | from config | Stamped onto the forwarded batch |

It also exposes `setEndpoint(endpoint)` and `setAppInfo(name, version)` for reconfiguring an
existing instance, plus `log(entry)` for sending a single record.

::: tip `headers` and `apiKey` are always sent
Both are merged into every request. Frogger sets its own trace/identity headers
(`traceparent`, `x-frogger-*`) too, and those always win — so your custom headers
can't accidentally clobber tracing. `apiKey` is always emitted as `x-api-key`;
Frogger never uses `authorization` or a query param for a transport key.
:::

## Declarative `transports` — no code required

For the common case — "forward every log to this collector" — you don't need to
write a plugin. Declare a list of destinations in your config and Frogger builds
the `HttpTransport`s and wires them into the right pipeline(s) for you:

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
    app: { name: 'marketing-site', version: '1.4.0' },

    transports: [
        // Ship logs to a self-hosted collector.
        {
            url: 'https://observe.example.com/api/observe/ingest',
            apiKey: process.env.OBSERVE_INGEST_KEY, // → `x-api-key: <key>` on every batch
            client: true,   // fan out directly from the browser (needed for static apps)
            server: true,   // AND from the Nitro server queue
        },
        // A second destination, server-side only, no auth.
        {
            url: 'https://logs.internal/ingest',
            // client defaults false, server defaults true
        },
    ],
})
```

Each entry is a destination:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | `string` | — | Full ingest URL. Shorthand for `baseUrl` (origin) + `endpoint` (path). Wins over the split form |
| `baseUrl` / `endpoint` | `string` | — | Split form, if you prefer it |
| `apiKey` | `string` | — | Sent as `x-api-key` on every batch to this destination |
| `headers` | `Record<string, string>` | `{}` | Extra headers merged onto each request |
| `client` | `boolean` | `false` | Fan out **directly from the browser** log queue |
| `server` | `boolean` | `true` | Fan out from the **Nitro server** log queue |
| `name` | `string` | resolved url | Label for diagnostics |
| `vendor`, `timeout`, `retryOnFailure`, `maxRetries`, `retryDelay` | | HttpTransport defaults | Per-destination tuning |

- **`server: true`** (the default) constructs an `HttpTransport` in the Nitro
  server queue that receives every ingested batch, alongside the file/websocket
  transports.
- **`client: true`** makes the **browser** POST each batch directly to that URL,
  independent of your app's own ingest endpoint. This is what lets a **static
  frontend with no backend** ship its logs somewhere.

Declarative transports are independent of your [`preset`](/configuration) — they
work under any preset, and default to no extra destinations.

### `observeTransport()` — ship to nuxt-observe

For a [nuxt-observe](https://github.com/zephkelly/nuxt-observe) deployment you
don't need to spell out the ingest URL and auth yourself. `observeTransport()`
encodes the observe contract (ingest path, header auth from the server, query
auth from the browser, and batch caps) from just the deployment origin and a
key:

```ts
import { observeTransport } from '#frogger/config'

transports: [
    // Relay from your server (default):
    observeTransport({ url: 'https://observe.example.com', key: process.env.OBSERVE_INGEST_KEY! }),

    // Or send directly from the browser (static sites):
    observeTransport({ url: 'https://observe.example.com', key: 'obsk_...', client: true }),
]
```

`server` defaults to `true` and `client` to `false`, like any other entry.
Observe ingest keys are write-only by design, so a `client: true` key does not
trigger the bundle-visible-key build warning. Metrics have a parallel factory,
[`metricObserveTransport()`](/guides/metrics#shipping-metrics-to-nuxt-observe),
on the separate `metrics.transports` list.

### `memoryTransport()` — capture logs for tests

`memoryTransport({ name })` is a server-only destination that keeps every log in
an in-memory array instead of writing to a file or HTTP endpoint. It's the
foundation of Frogger's [testing helpers](/guides/testing): add it to
`transports`, drive the code under test, then read the captures back with
`getCapturedLogs({ name })` from `nuxt-frogger/testing`.

```ts
import { memoryTransport } from '#frogger/config'

transports: [memoryTransport({ name: 'test' })]
```

The `name` is the shared key between the transport and the helper. See the
[Testing guide](/guides/testing) for the full workflow.

### Shipping logs to a collector

A client-direct POST to a different origin with `x-api-key` + a JSON body
triggers a CORS preflight (`OPTIONS`). The receiving collector must answer the
preflight and allow the `x-api-key` header. Self-hosted collectors such as
`nuxt-observe` handle this out of the box and read the [well-known `ctx`
keys](/getting-started#well-known-ctx-keys) (`session`, `user`, `route`,
`feature`) straight off each log.

### ⚠️ Security: client transport keys are public

Anything under a `client: true` transport — including its `apiKey` and `headers`
— is compiled into the **browser bundle** and visible in DevTools. A client
transport key is therefore **not a secret**. Only ever use a **write-only,
per-service, rate-limited ingest key** there — never a key that grants read or
admin. Frogger emits a build-time warning when a `client` transport carries an
`apiKey` to remind you.

Prefer `server: true` whenever your app has a backend: server transport keys live
in `runtimeConfig.frogger` and never reach the client. Because both live in
`runtimeConfig`, you can override keys per environment with
`NUXT_FROGGER_*` (server) / `NUXT_PUBLIC_FROGGER_*` (client) — source `apiKey`
from `process.env` rather than hardcoding it.
