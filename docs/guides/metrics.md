# Metrics

Frogger can collect **metrics** alongside logs. The metrics subsystem is a
fully separate pipeline from logging: it has its own ingest route, queue,
transports and wire format, and it is **off by default**.

Turning it on with `metrics: true` auto-collects two bounded-cardinality
signals and nothing else:

- **Web Vitals** — LCP, CLS, INP, FCP, TTFB, via Google's `web-vitals` library.
- **A device / network envelope** — connection type, device memory, CPU cores,
  browser/OS and viewport, attached once per batch.

There is no userland metrics API in this release: v1 is config-driven
auto-collection. A manual `defineMetric()` / `useFroggerMetrics()` API is
planned for a later release.

## Enable it

Metrics are opt-in and independent of the `preset` — enabling them is always an
explicit choice.

::: code-group

```ts [frogger.config.ts]
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
  metrics: true,
})
```

```ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['nuxt-frogger'],
  frogger: {
    metrics: true,
  },
})
```

:::

When metrics are off (the default), **nothing** is emitted: no client plugin,
no `/api/_frogger/metrics` route, no runtime-config keys, no server singleton.
`web-vitals` only reaches the client bundle when metrics are enabled.

## What `metrics: true` collects

Each web vital is emitted as a single **gauge** `MetricObject`:

| Metric name       | Unit     | Notes                          |
| ----------------- | -------- | ------------------------------ |
| `web.vital.lcp`   | `second` | Largest Contentful Paint       |
| `web.vital.cls`   | (none)   | Cumulative Layout Shift        |
| `web.vital.inp`   | `second` | Interaction to Next Paint      |
| `web.vital.fcp`   | `second` | First Contentful Paint         |
| `web.vital.ttfb`  | `second` | Time To First Byte             |

Timing values are converted to **seconds** (the OTel/Prometheus base-unit
convention); CLS is unitless. Only the final value per page load is reported by
default (`web-vitals` de-dupes bfcache restores for you); set
`webVitals: { reportAllChanges: true }` to emit every intermediate value.

Metrics are stored **raw** — one event per measurement — and aggregated on
read. Frogger never pre-aggregates into series at ingest, so percentiles are
computed by whatever consumes the JSON-lines file (`jq` / DuckDB / SQLite) or
your downstream store.

## Labels vs attributes — the cardinality model

Every metric carries two kinds of dimension, and the distinction is the core
guardrail against a cardinality blowup:

- **`labels`** — *indexed* dimensions. Every distinct label combination is a
  distinct series on read, so this must stay low-cardinality. Web vitals label
  on `rating` (`good` / `needs-improvement` / `poor`) and the route **pattern**
  (`/users/[id]`, never the resolved URL).
- **`attr`** — *non-indexed* detail carried for a single event but never
  indexed. Web vitals put the instance `id`, the raw `delta` and
  `navigationType` here.

Never put an id, a URL, or free-form user input in `labels`.

## Device context

The device envelope is collected and transmitted **once per batch**, then
stamped onto each stored event at server ingest (alongside the session and the
origin app, which lands in each event's `source` field). It is never emitted as
labels, so it can never multiply your series count. Every field is best-effort
and feature-detected; an unsupported API is `null`, never `0`:

```ts
{
  ua: 'Mozilla/5.0 …',        // stamped server-side from the request header
  browser: 'Chromium',        // from navigator.userAgentData
  os: 'Windows',
  deviceType: 'desktop',
  effectiveType: '4g',        // navigator.connection
  deviceMemory: 8,
  hardwareConcurrency: 12,
  viewport: { w: 1920, h: 1080 },
}
```

::: warning Safari / Firefox undercount
`navigator.userAgentData`, `navigator.connection` and `navigator.deviceMemory`
are Chromium-mostly APIs. On Safari and Firefox several of these fields will be
`null` — expect device stats to undercount outside Chromium.
:::

## Trace exemplars

Each metric can carry a `trace: { traceId, spanId }` pointing at the page's
trace, so a slow LCP can be lined up against that page load's logs. The trace
and route are captured **once at page load**, because CLS and INP report at
page hide — after SPA navigation may have moved the current route.

::: warning Dangling trace references
A metric's `traceId` is an **exemplar pointer, not a foreign key**. If the
session was sampled out of logging (or logs were dropped), the referenced
trace's logs may not exist. Treat the link as best-effort.
:::

## Configuration reference

```ts
metrics: {
  // Web Vitals collection. Default on. `{ reportAllChanges: true }` emits every
  // intermediate value instead of the final per-page value.
  webVitals: true,

  // Device / network / viewport envelope. Default on.
  deviceStats: true,

  // Session-level sampling in [0, 1], decided ONCE per session and persisted in
  // sessionStorage (survives hard reloads in a tab). Default 1.
  sampleRate: 1,

  // In-memory hard cap on metric events per page load. On overflow, events are
  // dropped and one internal warning is emitted. Default 500.
  maxEventsPerPage: 500,

  // SERVER metrics-queue batching (own default — a longer window than the
  // client). `false` disables server batching.
  batch: { maxAge: 15000 },

  // Metric destinations — a SEPARATE list from the log `transports`.
  transports: [
    metricFileTransport(),                    // rotated JSON-lines under logs/metrics/
    metricMemoryTransport({ name: 'test' }),  // in-memory capture for tests
    metricObserveTransport({                  // ship to a nuxt-observe deployment
      url: 'https://observe.example.com',
      key: process.env.OBSERVE_INGEST_KEY!,
    }),
  ],

  public: {
    endpoint: '/api/_frogger/metrics',        // ingest route the browser POSTs to
    batch: { maxAge: 5000 },                   // CLIENT metrics-queue batching (shorter)
  },
}
```

Import the metric transport factories from `#frogger/config` (or from
`nuxt-frogger` in `nuxt.config.ts`):

```ts
import {
  metricFileTransport,
  metricMemoryTransport,
  metricObserveTransport,
} from '#frogger/config'
```

Metric transports are a deliberately separate list from the log `transports`;
they share no body types.

## Shipping metrics to nuxt-observe

`metricObserveTransport()` is the metrics sibling of the log
[`observeTransport()`](/guides/transports#observetransport-—-ship-to-nuxt-observe): one entry is enough to ship every
collected metric to a [nuxt-observe](https://github.com/zephkelly/nuxt-observe)
deployment. It encodes the observe ingest contract for you: the metrics ingest
path (`/api/observe/ingest/frogger/metrics`), where the key is sent, and batch
caps (500 events / ~950 KiB per request) so a chunk is never rejected as too
large.

```ts
// frogger.config.ts
import { defineFroggerOptions, metricObserveTransport } from '#frogger/config'

export default defineFroggerOptions({
  metrics: {
    transports: [
      metricObserveTransport({
        url: 'https://observe.example.com',        // deployment origin
        key: process.env.OBSERVE_INGEST_KEY!,      // write-only ingest key
      }),
    ],
  },
})
```

By default this is a **server relay**: your Nitro server receives the browser's
metric batches at `/api/_frogger/metrics` and forwards them to observe with the
key in an `x-api-key` header, so the key never reaches the client bundle.

### Browser-direct (`client: true`)

A static site with `serverModule: false` has no server to relay through. Set
`client: true` and the browser sends batches straight to observe instead:

```ts
metricObserveTransport({
  url: 'https://observe.example.com',
  key: 'obsk_...',       // ships in the browser bundle (write-only by design)
  client: true,
  server: false,         // no server to relay from on a static site
})
```

Browser-direct sends carry the key as a `?key=` query parameter rather than a
header. That is deliberate: observe resolves its CORS allowlist from the query
string, and `sendBeacon` (the page-exit path) cannot set headers at all, which
makes query auth the only possible beacon auth.

::: warning Client keys are public
Everything on a `client: true` entry, including `key`, is compiled into the
browser bundle. Observe ingest keys are write-only, per-service and rate-limited
by design, so this is safe. Never put a key that grants read or admin
access on a client transport. See the
[security note in the transports guide](/guides/transports#⚠️-security-client-transport-keys-are-public).
:::

Each entry supports:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | `string` | — | **Required.** The observe deployment origin |
| `key` | `string` | — | **Required.** Ingest API key |
| `server` | `boolean` | `true` | Relay from the Nitro server metrics queue |
| `client` | `boolean` | `false` | Send directly from the browser |
| `name` | `string` | `observe (<origin>)` | Label for diagnostics (never contains the key) |
| `timeout`, `retryOnFailure`, `maxRetries`, `retryDelay` | | transport defaults | Per-destination tuning |

## How delivery works

- In-session, batches are POSTed to `/api/_frogger/metrics` via `$fetch` with
  `keepalive` set, so an in-flight send survives the page being hidden.
- Any `client: true` metric transports receive the same batch in parallel, each
  with its own bounded retry (`Retry-After` and `429` respected). A failing
  destination never blocks the others or the primary send.
- On page exit (`visibilitychange → hidden` primary, `pagehide` secondary), the
  queue drains via `navigator.sendBeacon` as a plain JSON string, split into
  small chunks (the ~64KB beacon quota is shared across all in-flight beacons),
  falling back to `fetch(keepalive)` if a beacon is refused. Exit chunks go to
  the primary ingest route and to every client transport. The server ingest
  route accepts both the `application/json` and beacon `text/plain` bodies.
- On the server, buffered metrics are drained on shutdown (the Nitro `close`
  hook), so a deploy or restart does not lose the batching window.

::: info Rate limiting is shared with logs
When [rate limiting](/guides/rate-limiting) is enabled, the metrics ingest
route checks the **same per-IP budget** as the log ingest, so a metrics burst
counts against the same window as logs. At Web Vitals volume (a handful of
events per page load) this is the right trade; a separate metrics budget is
planned alongside the manual metrics API.
:::

## Testing metrics

`nuxt-frogger/testing` provides metric capture helpers parallel to the log
ones, built on the memory transport:

```ts
import {
  metricMemoryTransport,
  getCapturedMetrics,
  clearCapturedMetrics,
  flushFroggerMetrics,
} from 'nuxt-frogger/testing'

// config: metrics: { batch: false, transports: [metricMemoryTransport({ name: 'test' })] }

const lcp = getCapturedMetrics({ store: 'test', name: 'web.vital.lcp' })
```

For end-to-end tests, `nuxt-frogger/playwright` exports
`useFroggerMetricsCapture(page)` with `getMetrics` / `waitForMetric` /
`expectMetric` / `clear`.
