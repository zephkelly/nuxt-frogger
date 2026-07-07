# Transports & HttpTransport

Once a log reaches the server it's handed to one or more **transports** — the things that
actually persist or forward it. Frogger ships with a file transport (the default sink) and an
`HttpTransport` for forwarding elsewhere. On the logger side, **reporters** let you fan out logs
to anywhere you like.

## File transport (the default)

By default, every ingested log is appended as a line of JSON to a rotated log file:

```bash
logs/2026-06-26.log     # one JSON object per line (JSON-lines)
```

- **Date rotation** — a new file per day, named by `fileNameFormat` (default `YYYY-MM-DD.log`).
- **Size rotation** — when a file passes `maxSize` (default 10 MB) it's rotated.
- **Buffered writes** — logs are buffered and flushed on an interval for throughput, controlled
  by `flushInterval`, `bufferMaxSize`, and `highWaterMark`.

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
    file: {
        directory: 'logs',            // where files are written (resolved at build time)
        fileNameFormat: 'YYYY-MM-DD.log',
        maxSize: 10 * 1024 * 1024,    // 10 MB
        flushInterval: 1000,          // ms
        bufferMaxSize: 1 * 1024 * 1024,
        highWaterMark: 64 * 1024,
    },
})
```

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
