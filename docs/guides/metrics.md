# Metrics

Frogger can collect **metrics** alongside logs. The metrics subsystem is a
fully separate pipeline from logging: it has its own ingest route, queue,
transports and wire format, and it is **off by default**.

Turning it on with `metrics: true` auto-collects two bounded-cardinality
signals and nothing else:

- **Web Vitals** — LCP, CLS, INP, FCP, TTFB, via Google's `web-vitals` library.
- **A device / network envelope** — connection type, device memory, CPU cores,
  browser/OS and viewport, attached once per batch.

Everything else is opt-in on top: a **manual metrics API** (`froggerMetrics`),
**per-request server instrumentation**, and **Node runtime health**.

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

## The manual metrics API

`froggerMetrics` is auto-imported on **both runtimes** whenever metrics are
enabled. It costs nothing until you call it.

```ts
// Anywhere in a component, composable, Nitro route or task
froggerMetrics.counter('order.placed')
froggerMetrics.counter('email.sent', 3)

froggerMetrics.gauge('queue.depth', pending.length)

froggerMetrics.histogram('db.query.duration', seconds, {
  unit: 'second',
  labels: { op: 'select' },
})
```

### Timing something

```ts
const stop = froggerMetrics.timer('report.render')
await render()
stop({ labels: { ok: true } })
```

Or wrap it:

```ts
const rows = await froggerMetrics.time('db.query', () => db.select(), {
  labels: { op: 'select' },
})
```

`time()` records the duration whether the function resolves or throws, tagging
the point with `ok: true` / `ok: false`, and rethrows.

### Options

| Option | Meaning |
| --- | --- |
| `unit` | Base unit: `'second'`, `'byte'`, or `''`. Follows the OTel/Prometheus convention. |
| `labels` | **Indexed** dimensions. Every distinct combination is a series — keep them bounded by your source code, never by user data. |
| `attr` | **Non-indexed** detail carried for this one event. Ids, urls, raw deltas. |
| `trace` | Exemplar override, for a point whose subject is not the ambient span. |
| `correlate: false` | Record with no trace, session, user or route at all. |
| `time` | Epoch-ms override. For deterministic tests. |

### Guard rails

A metric's **kind is locked at first use**. If `counter('x')` and `gauge('x')`
both appear, the second is dropped with one warning rather than corrupting the
series — rename one of the two call sites.

**Label cardinality is bounded** at 200 distinct combinations per name. Past
that, points keep their *value* but their labels are replaced with
`{ overflow: true }`, and you get one warning. A label that overflows is almost
always carrying an id, a url or free-form user input — those belong in `attr`.

## Identifying the user

```ts
frogger.identify(user.id)   // sets the user for logs AND metrics
frogger.identify(null)      // on sign-out
```

`frogger.identify()` is the one call to make. It sets the top-level `user`
field on log rows and the `user` field on metric points, so the two pipelines
can never disagree about who is acting.

::: warning Deprecated
`setFroggerMetricsUser()` sets the user for metrics only and is removed in
0.3.0. Use `frogger.identify()`.
:::

## Per-request instrumentation

`metrics: { requests: true }` records `http.server.request.duration` for every
request, from Nitro's own response hooks — no per-handler wrapping.

```ts
metrics: {
  requests: true,
}
```

Each point carries `http.request.method`, `http.route` and
`http.response.status_code` as labels.

::: tip Why some requests are not recorded
`http.route` is always the **matched route pattern** (`/orders/[id]`), never
the raw path. A raw URL is unbounded cardinality — `/orders/1`, `/orders/2` and
so on would each be their own series, and a metrics backend does not recover
from that.

If a request has no matched pattern, the measurement is **dropped** rather than
falling back to the path. Frogger's own `/api/_frogger/*` routes are excluded
too, since instrumenting the ingest route is a feedback loop.
:::

`{ requests: { serverTiming: true } }` additionally sets a `Server-Timing`
response header from the request's completed spans, so browser devtools show
the server breakdown inline.

## Node runtime health

`metrics: { runtime: true }` samples the Node process itself from
`node:perf_hooks`, with no new dependencies:

| Metric | Unit | What it tells you |
| --- | --- | --- |
| `nodejs.eventloop.delay.p50/p90/p99` | second | How long the event loop was blocked. This is what explains "the server is slow but every handler is fast". |
| `nodejs.eventloop.utilization` | — | Fraction of time the loop was busy, as a delta since the last sample. |
| `v8js.gc.duration` | second | GC pause duration, labelled by `v8js.gc.type`. |
| `v8js.memory.heap.used` / `.limit` | byte | Heap usage. |
| `nodejs.memory.rss` | byte | Resident set size. |

Names and units are `@opentelemetry/instrumentation-runtime-node`'s verbatim,
so nothing downstream needs a translation table.

```ts
metrics: {
  runtime: { intervalMs: 15000 },  // sampling period; 15s default
}
```

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
  // `{ attribution: true }` loads the web-vitals/attribution build, which adds
  // WHY a vital was what it was (the LCP element, the TTFB/load/render split)
  // into the non-indexed `attr` slot — no cardinality cost. Off by default
  // because the attribution build is a larger bundle.
  webVitals: true,

  // Per-request server instrumentation from Nitro's response hooks:
  // http.server.request.duration, labelled by route pattern, method and status.
  // Off by default. `{ serverTiming: true }` also sets a Server-Timing header.
  requests: false,

  // Node runtime health from node:perf_hooks: event-loop delay percentiles,
  // event-loop utilization, GC pause duration and heap usage. Off by default.
  runtime: false,

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
