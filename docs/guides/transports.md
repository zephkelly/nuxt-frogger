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
    headers: { authorization: `Bearer ${token}` },
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
| `headers` | `Record<string, string>` | `{}` | Extra request headers (auth, etc.) |
| `timeout` | `number` | `30000` | Per-request timeout (ms) |
| `retryOnFailure` | `boolean` | `true` | Retry failed sends |
| `maxRetries` | `number` | `3` | Max retry attempts |
| `retryDelay` | `number` | `1000` | Base delay (ms); backoff is exponential |
| `appInfo` | `{ name, version? }` | from config | Stamped onto the forwarded batch |

It also exposes `setEndpoint(endpoint)` and `setAppInfo(name, version)` for reconfiguring an
existing instance, plus `log(entry)` for sending a single record.
