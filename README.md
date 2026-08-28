# 🐸 Frogger

### The zero-setup logger for Nuxt

Log and trace from anywhere in your Nuxt applications. Server to client, client to server, to external services and back again. Install Frogger - add it as a module, and it just works. Automatically batches and sends logs to the server. No matter where you make a log, you'll find it in the same place.

A bare install logs to the **console** only. Add persistent destinations declaratively with the transport factories — rotated JSON-lines files with `fileTransport()`, any HTTP ingest with `httpTransport()`, or a [nuxt-observe](https://github.com/zephkelly/nuxt-observe) deployment with `observeTransport()`:

```ts
// frogger.config.ts
import { defineFroggerOptions, fileTransport, observeTransport } from '#frogger/config';

export default defineFroggerOptions({
    transports: [
        fileTransport(),                                          // logs/ on disk
        observeTransport({ url: 'https://observe.app.com', key }) // forward to observe
    ],
});
```

## Metrics (opt-in)

Frogger can also collect **metrics** — a fully separate pipeline from logging,
**off by default**. Turn it on with `metrics: true` to auto-collect Web Vitals
(LCP/CLS/INP/FCP/TTFB) and a per-batch device/network envelope:

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config';

export default defineFroggerOptions({
    metrics: true,
});
```

Metrics can be shipped to a [nuxt-observe](https://github.com/zephkelly/nuxt-observe)
deployment with a single transport entry - relayed from your server, or sent
directly from the browser on static sites:

```ts
import { defineFroggerOptions, metricObserveTransport } from '#frogger/config';

export default defineFroggerOptions({
    metrics: {
        transports: [metricObserveTransport({ url: 'https://observe.example.com', key: 'obsk_...' })],
    },
});
```

Metrics are stored raw and aggregated on read, carry an optional trace exemplar
linking each measurement to the page's trace, and never touch the logging
pipeline. See the [Metrics guide](https://zephkelly.github.io/nuxt-frogger/guides/metrics) for the config reference and cardinality model.

## Installation

### Automatic Installation

To install and register the latest version of Frogger, navigate to your Nuxt project and run the following command:

**pnpm:**
```sh
pnpm dlx nuxi@latest module add nuxt-frogger
```

**npm:**
```sh
npx nuxi@latest module add nuxt-frogger
```

### Manual Installation

Does the command above not work? You can install Frogger and register it manually:

**pnpm:**
```sh
pnpm add nuxt-frogger
```

**npm:**
```sh
npm install nuxt-frogger
```

### Register the Module

Add `'nuxt-frogger'` to `modules` in your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ]
})
```

## Migrating to 0.2.0 (breaking)

Most applications need **no code changes**. The full page, with what to check
and how to restore each old default, is at
[docs/migration/0.2.md](docs/migration/0.2.md).

The headlines:

- **`preset: 'standard'` and `'full'` now actually redact.** They documented redaction and resolved to a scrubber with **zero rules**. They now seed `RECOMMENDED_RULES`.
- **Frogger no longer takes over host shutdown.** The `SIGTERM`/`SIGINT` handlers that called `process.exit(0)` are off by default (`errorCapture.server.takeoverSignals` restores them).
- **Error capture no longer ships secrets.** `includeHeaders`, `includeComponentProps` and `includeComponentOuterHTML` all default to `false`.
- **Rate limiting ignores forwarding headers by default.** Set `rateLimit.trustProxy` if you run behind a proxy.
- **`lvl` changed for `verbose` and `silent`** — they were ±Infinity, which serialises to `null`. Rows also gained `sev`, the OTel SeverityNumber.
- **`trace.parentId` is now `trace.parentSpanId`**, and each logger owns one stable `spanId` for its lifetime.
- **Removed:** `LoggerObject.tags` and its live-log filter (written by no code path), the dead websocket query scaffold, and `public.serverModule`.
- **Nuxt 4 is a declared peer dependency.**

Already shipped in 0.1.x, and still worth knowing:

- **File logging is not on by default.** A bare install logs to the console only. Add `fileTransport()` to `transports`.
- **The top-level `file` module option was removed.** Move its settings into `fileTransport({ ... })`.
- **`public.endpoint` accepts `false`** to disable the browser POST to your app's own ingest route while keeping the server route registered.
- **Plain `{ url, apiKey }` transport objects still work** (an untagged entry is treated as `httpTransport(...)`).
- **`HttpTransport` retry semantics were fixed.** Failures used to be silently swallowed; they now retry (429/5xx/network) with jittered exponential backoff and drop deterministically on a non-429 4xx.