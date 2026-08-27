# nuxt-frogger metrics subsystem — phased plan

## Context

Frogger is currently a logging + W3C tracing module; the goal is to grow it into an all-in-one logging **and metrics** library. Today there is no metrics capability at all (no page-speed stats, no device stats). The maintainer's constraints, all non-negotiable:

- Metrics are a **separate subsystem** from the logging pipeline (not logs-with-a-metric-field).
- Metrics are **off by default**, opt-in via config, matching the existing opt-in philosophy (`scrub`/`rateLimit`/`websocket`/`errorCapture`).
- Start **small**: a solid foundation, then a few key metrics/features at a time. Page-speed stats and device stats are the first two capabilities.

This plan is informed by a multi-agent research pass (Sonnet web researchers on Datadog, Sentry, Grafana/Prometheus/Loki/Faro, and OTel/web-vitals/browser-API standards; an Explore agent codebase map; two Opus advisors for product and architecture) and was then adversarially reviewed by a Fable agent against the real source — its confirmed findings (unexported `normalizeToggle`, the rate-limiter refactor's true size, the trace-exemplar and `route`-label mechanisms, sendBeacon's `text/plain` body vs h3 `readBody`, split batch defaults, session semantics) are folded in below. The decisive research findings:

1. **Store raw, trace-linked metric events and aggregate on read. Never pre-aggregate into series at ingest.** Sentry's pre-aggregated custom-metrics product (DDM) ran ~18 months in beta and was killed just before GA: pre-aggregation materializes one stored series per tag combination (cardinality blowup) and severs the metric→trace link. Self-hosted, the same footgun is unbounded disk/RAM instead of a bill. Web vitals are ~5-7 events per page load, so raw is cheap.
2. **Lead with auto-collected Web Vitals + a device/network context envelope**, not a custom-metrics API (leading with custom metrics is the exact mistake Sentry made).
3. **Wrap Google's `web-vitals` library** (~2KB brotli, Apache-2.0) — Sentry, Grafana Faro, and the Chrome team all wrap it. It solves bfcache-restore de-dup, `buffered:true` late-load, and cross-browser observer quirks.
4. **Cardinality guardrails from day one**: 3 metric kinds (counter/gauge/histogram) locked at definition, an indexed-`labels` vs non-indexed-`attr` split, per-batch (not per-point) device context, session-level sampling, per-session event caps.
5. **Flush on `visibilitychange → hidden` (primary) + `pagehide` (secondary), never `beforeunload`/`unload`** (breaks bfcache, unreliable on mobile). `sendBeacon` on exit, `$fetch` in-session, batches kept well under the ~64KB beacon quota.

## Decisions made with the maintainer

- **V1 scope**: foundation + Web Vitals + device stats in one release (a foundation with nothing to collect can't be tested or dogfooded).
- **Naming**: `useFroggerMetrics()` + ambient `froggerMetrics` (collision-safe; matches the `useFroggerWebSocket` precedent). Public API lands in Phase 2 — v1 is config-driven auto-collection with no userland API.
- **`web-vitals`**: direct runtime dependency. It only reaches the client bundle when `metrics` is enabled (the collector plugin is only registered then).
- **Docs**: new VitePress guide `docs/guides/metrics.md` + sidebar entry, plus AGENTS.md and README updates.

## Design decisions (locked by research consensus)

- **Fully parallel pipeline** under `src/runtime/metrics/`: copy the log pipeline's *structural idioms*, share **zero body types and zero mutable state**. Do not enqueue metrics into `LogQueueService`/`ServerLogQueueService`; do not reuse `LoggerObject`-typed transports; do not run `LogScrubber` on metrics (its metrics analogue is a label allowlist, a different operation — Phase 2).
- **Separate ingest route** `/api/_frogger/metrics` (own queue, buffers, config, transport union). Registered only when metrics are enabled — unlike the log route, which stays always-registered.
- **Separate `metrics.transports` list** with parallel pure factories (`metricFileTransport`, `metricMemoryTransport`; `metricHttpTransport` in Phase 2). Same tagged-serializable-factory discipline as `shared/transports/factories.ts`, different body contract.
- **`metrics: true` enables Web Vitals + device stats only** — the free, bounded-cardinality signals. Everything heavier gets its own flag. Metrics stay **out of the `minimal`/`standard`/`full` presets** entirely (like `transports`): enabling data collection is always an explicit choice.
- **Raw delta events, aggregate on read.** No summing/bucketing in-process anywhere in v1. Percentiles are computed by whatever reads the JSON-lines file (jq/DuckDB/SQLite) or the downstream store.
- **Trace exemplar, not a log**: each `MetricObject` carries optional `trace: { traceId, spanId }` from the active frogger span. Document the dangling-reference caveat (a sampled-out session's logs may not exist for a metric's traceId).

## Phase 1 — this implementation

### Data model (`src/runtime/metrics/shared/types/`)

```ts
// metric.ts
export type MetricKind = 'counter' | 'gauge' | 'histogram'
export type MetricLabels = Record<string, string | number | boolean>

export interface MetricObject {
  time: number                  // epoch ms
  name: string                  // dot-namespaced: 'web.vital.lcp'
  kind: MetricKind
  value: number
  unit?: string                 // base units: 'second' | 'byte' | ''
  labels?: MetricLabels         // indexed dims ONLY: rating, route pattern — never ids/urls
  env: 'ssr' | 'csr' | 'client' | 'server'
  source?: { name: string; version: string }
  trace?: { traceId: string; spanId?: string }   // exemplar pointer, not a log
  attr?: Record<string, string | number | boolean> // non-indexed detail: id, delta, navigationType
}

// metric-batch.ts
export interface MetricContext {   // once per batch, never per point, never labels
  ua?: string                      // raw UA header, stamped server-side at ingest
  browser?: string; os?: string; deviceType?: string   // from client userAgentData, best-effort
  effectiveType?: string | null    // navigator.connection — null (not 0) when unsupported
  deviceMemory?: number | null
  hardwareConcurrency?: number | null
  viewport?: { w: number; h: number }
}
export interface MetricObjectBatch {
  metrics: MetricObject[]
  app?: { name?: string; version?: string }
  context?: MetricContext
  session?: { id: string; sampled: boolean }   // uuidv7 session id, one sample decision per session
  meta?: { processChain?: string[]; source?: string; time?: number }  // same loop-detection convention as logs
}
```

Web vitals map to gauges: `web.vital.lcp|cls|inp|fcp|ttfb`, `labels: { rating, route }` (route **pattern** `/users/[id]`, never resolved URL), `attr: { id, delta, navigationType }`, unit `second` (CLS unitless).

### Config surface

`ModuleOptions.metrics?: MetricsOptions | boolean` in [module-options.ts](src/runtime/shared/types/module-options.ts), normalized false-or-full-object via the existing `normalizeToggle` in [resolve-options.ts](src/runtime/shared/utils/resolve-options.ts):

```ts
export interface MetricsOptions {
  webVitals?: boolean | { reportAllChanges?: boolean }   // default true when metrics on
  deviceStats?: boolean                                  // default true when metrics on
  sampleRate?: number              // session-level 0..1, decided once per session, default 1
  maxEventsPerPage?: number        // in-memory per-pageload hard cap, default 500, drop + one froggerInternal.warn
  batch?: BatchOptions | false     // SERVER queue batching (own DEFAULT_METRICS_BATCH, e.g. maxAge 15000)
  transports?: FroggerMetricTransportConfig[]   // parallel union, NOT the log transports
  public?: {
    endpoint?: string | false      // default '/api/_frogger/metrics'
    batch?: BatchOptions | false   // CLIENT queue batching (own DEFAULT_METRICS_PUBLIC_BATCH, shorter maxAge)
  }
}
```

Server and client batching get **distinct defaults** (mirroring the log pipeline's deliberate `DEFAULT_BATCH` maxAge 15000 vs `DEFAULT_PUBLIC_BATCH` maxAge 3000 split in `resolve-options.ts`) — a single shared key would either churn server transports or hold client batches too long. No `rateLimit` key in v1: the ingest route shares the existing log rate-limit budget via `getFroggerRateLimiter().check(event)` (inert when the subsystem is off); only a *separate* `metrics.rateLimit` budget needs the Phase 2 keyed-instance refactor (see roadmap). The route keeps the 413 content-length guard regardless, and only exists when metrics are enabled.

**Session semantics**: `{ id: uuidv7, sampled }` is persisted in `sessionStorage` (key `frogger:metrics:session`) so the sampling decision and session id survive hard reloads within a tab (Faro's decide-once model); `maxEventsPerPage` is an in-memory per-pageload cap.

Resolver: new `resolveMetricsOptions()` + `resolveMetricTransports()` (same switch-on-`type`, split server/client discipline as `resolveTransports`) in `src/runtime/metrics/shared/utils/resolve-metrics.ts`, called from `resolveFroggerOptions`; `ResolvedFroggerOptions.metrics: ResolvedMetricsOptions | false`. (`normalizeToggle` is exported from [resolve-options.ts](src/runtime/shared/utils/resolve-options.ts) and already imported by `resolve-metrics.ts`.)

runtimeConfig (mirroring the existing split in [module.ts](src/module.ts)): `public.frogger.metrics = { endpoint, webVitals, deviceStats, sampleRate, maxEventsPerPage, batch: public.batch, transports: client }`; `frogger.metrics = { transports: server, batch }`. When `metrics === false`: **nothing** emitted, no plugin/route/singleton — fully inert like every other opt-in subsystem. All v1 option values are plain serializable data (verified — nothing function-typed).

### Client pipeline (`src/runtime/metrics/app/`)

- `services/metrics-queue.ts` — `MetricsQueueService`: copy `LogQueueService`'s timer batching and `flush()`; a bespoke bounded backoff replaces the log queue's 429 `limit-handler` machinery (its header parsing is unreachable at web-vitals volume); new body type; enforce `maxEventsPerPage`; apply the session sampling decision (unsampled session ⇒ collectors never enqueue).
- `services/get-metrics-queue.ts` — copy the `getLogQueue(nuxtApp)` lazy-construct-and-cache idiom verbatim (cache key `'$froggerMetricsQueue'`); deliberately not plugin-injected (same boot-order reasoning as [get-log-queue.ts](src/runtime/app/services/get-log-queue.ts)).
- `collector/web-vitals.ts` — wire `onLCP/onCLS/onINP/onFCP/onTTFB` from `web-vitals`, convert callbacks to `MetricObject`s. Final-value only by default (`reportAllChanges` opt-in). Do not re-invoke on `pageshow` (the library handles bfcache restores). `web-vitals` must only be imported from client-side files (it touches browser globals at import).
- `collector/device.ts` — read `navigator.connection.effectiveType` / `deviceMemory` / `hardwareConcurrency` / `userAgentData` / viewport once per batch, feature-detected, `null` when unsupported; returns the `MetricContext` envelope.
- `plugins/metrics.client.ts` — registered only when metrics + clientModule enabled: init collectors, load-or-mint the sessionStorage `{ id, sampled }` record, flush on `visibilitychange → hidden` (primary) + `pagehide` (secondary) via `navigator.sendBeacon` (fall back to `fetch(keepalive)` when beacon returns false / payload too big); `$fetch` for in-session sends.
- **Trace exemplar mechanism**: capture the page's trace context **once at plugin init** from the ambient client logger ([app/frogger.ts](src/runtime/app/frogger.ts) `getAmbientClientLogger`, which already continues the SSR→CSR handoff trace) and stamp it on all of that page load's metrics. An active span at collector-callback time (`getActiveLogger()` from [active-context.client.ts](src/runtime/logger/active-context.client.ts)) is an opportunistic override only — vitals callbacks fire from PerformanceObserver, essentially never inside a user span, so the page-level trace is the load-bearing path.
- **`route` label source in v1**: captured **once at plugin init** as the landing route's matched **pattern** (last entry of `router.currentRoute.value.matched`, `.path` — vue-router renders it as `/users/:id()`; keep that form) and stamped on every vital for that page load. Reading the route at report time would mis-attribute — CLS/INP report at `visibilitychange → hidden`, after SPA navigation may have changed the current route. Full route-change timing remains Phase 3.
- `shared/utils/split-metric-batch.ts` — `splitMetricBatch()` sibling of [split-batch.ts](src/runtime/shared/utils/split-batch.ts) (greedy algorithm), cap batches well under the ~64KB beacon quota.
- **Beacon body contract**: `sendBeacon(url, jsonString)` sends `text/plain;charset=UTF-8` — a `Blob` with `application/json` would break cross-origin beacons (no preflight possible). So the client beacons a plain JSON string and the **server accepts it** (next section). `sendBeacon` returning `true` is not delivery confirmation; the string-body path must be the tested, primary exit contract.

### Server pipeline (`src/runtime/metrics/server/`)

- `api/metrics.post.ts` — content-length 413 guard and `meta.processChain` loop detection (same conventions as [logger.post.ts](src/runtime/server/api/logger.post.ts)); **must accept `text/plain` string bodies**: h3's `readBody` only JSON-parses when content-type is exactly `application/json`, and beacons arrive as `text/plain` — use `readRawBody` + parse (or `typeof body === 'string' → JSON.parse`) so page-exit batches are not silently dropped; stamp `context.ua` from the request's user-agent header (raw string only — parsing/geo deferred to Phase 3, zero new deps); enqueue into the metrics queue. Rate limiting shares the log budget (`getFroggerRateLimiter().check(event)`); beacon chunks stamp a fresh `meta` at the send site so loop/staleness detection runs on exit traffic too.
- `services/server-metrics-queue.ts` — `ServerMetricsQueueService`: copy the `getInstance()` + `initialise()`-from-runtimeConfig singleton shape of [server-log-queue.ts](src/runtime/server/services/server-log-queue.ts); per-transport try/catch isolation; **no aggregation** — raw fan-out only.
- `plugins/metrics-queue.server.ts` — lifecycle plugin (mirrors `log-queue.server.ts`).

### Transports (`src/runtime/metrics/_transports/`)

`IFroggerMetricsTransport` interface + `batch-metrics-transport.ts` (copy `insertSorted`/`maxAge`/`maxSize` scheduling from the log `BatchTransport`, retyped) + v1 sinks:
- `file-metrics-transport.ts` — rotated JSON-lines, default directory `logs/metrics/` (distinct from log files).
- `memory-metrics-transport.ts` — `globalThis.__FROGGER_METRICS_STORE__` registry, exactly the [memory-transport.ts](src/runtime/logger/_transports/memory-transport.ts) idiom.

Pure factories in `src/runtime/metrics/shared/transports/factories.ts`: `metricFileTransport()`, `metricMemoryTransport()`. Re-export from [runtime/options.ts](src/runtime/options.ts) (`#frogger/config`) and [module.ts](src/module.ts) like the log factories.

### Module wiring ([module.ts](src/module.ts))

Gate everything on `resolved.metrics !== false` (+ the respective `clientModule`/`serverModule` checks): `addPlugin(metrics.client)`, `addServerPlugin(metrics-queue.server)`, `addServerHandler({ route: '/api/_frogger/metrics', ... })`, runtimeConfig branches. Add `web-vitals` to package.json `dependencies`. All internal diagnostics via `froggerInternal.*` (never `console.*` — keeps the Playwright tripwire honest).

### Testing (per repo convention)

- Unit (`test/`): `resolve-metrics` normalization (false/true/partial/precedence, transports split, distinct server/client batch defaults), `split-metric-batch`, web-vital-callback → `MetricObject` mapping, session sampling determinism, `maxEventsPerPage` cap.
- Nuxt-env (`*.nuxt.test.ts`): ingest route → `ServerMetricsQueueService` → memory sink round-trip (mirror the server-queue nuxt test; `batch: false` + flush), **including a batch POSTed with `text/plain` content-type** (the sendBeacon contract).
- `src/testing/index.ts` additions: `getCapturedMetrics(opts?)`, `clearCapturedMetrics(name?)`, `filterMetrics(metrics, matcher)`, `flushFroggerMetrics()` — same registry/dynamic-import discipline; no new build entry (rides the existing `./testing` export). Explicit `.js` extensions on cross-dir imports (mkdist).
- `src/playwright/index.ts` additions: `useFroggerMetricsCapture(page)` routing `**/api/_frogger/metrics` POSTs with `getMetrics/waitForMetric/expectMetric/clear`.
- Playground: enable `metrics: true` + `metricMemoryTransport`/`metricFileTransport` in the playground config; a demo page that renders so web vitals fire.

### Docs

- New `docs/guides/metrics.md`: opt-in setup, what `metrics: true` auto-collects, config reference, the labels-vs-attr cardinality model, Safari/Firefox device-API undercount caveat, dangling trace-reference caveat. Sidebar entry in `docs/.vitepress/config.ts`.
- Update `AGENTS.md` (new subsystem map section) and `README.md`.

## Later phases (roadmap only — not in this implementation)

- **Phase 2 — manual metrics API + more signals**: `defineMetric(name, { kind, unit, labels })` (kind locked at definition, declared label allowlist, reject UUID/URL-shaped values), `useFroggerMetrics()` composable + ambient `froggerMetrics` (`count`/`gauge`/`histogram`), `metricHttpTransport` + `HttpMetricsTransport` (client+server fan-out), `beforeSend` hook (shaped like scrub), resource-timing + long-task collectors behind their own default-off flags. **Separate metrics rate-limit budget** (the shared-budget case shipped in v1): requires a keyed-instance refactor of the rate limiter — `SlidingWindowRateLimiter.getInstance()` is a single static instance hard-coded to `runtimeConfig.frogger.rateLimit` and the `frogger-rate-limiter` KV namespace, so a real per-subsystem budget needs `getInstance(key)` backed by a Map, a parameterized config path + KV namespace, and `resetInstance` clearing the map. Deliberately deferred: it is the only change touching existing shared code, and `metrics.rateLimit` would default off anyway.
- **Phase 3 — server + route timing**: server runtime metrics (request-duration histogram, event-loop lag, memory) behind `serverRuntime`; manual route-change timing via `router.afterEach` (route **pattern** labels); server UA parsing + opt-in `geo` enrichment; `sampler(ctx)` callback — note this cannot be a config key (`frogger.config.ts` is serialized into runtimeConfig, functions don't survive); register it via a `frogger:init`-style Nuxt hook instead.
- **Phase 4 — read/export**: aggregate-on-read query helpers; dev websocket live metrics view (extend the existing WS machinery); Prometheus text-exposition endpoint + OTLP export adapter (the OTel-shaped internal schema keeps these thin).
- **Phase 5 — attribution**: web-vitals attribution build behind a flag, Long Animation Frames for INP root-cause, revisit automatic soft-navigation vitals when the platform API stabilizes (currently origin-trial — do not build on it now).

**Explicitly never**: server-side pre-aggregation at ingest, free-form tags without an allowlist, Session Replay, StatsD/UDP daemons, global cross-host percentiles/DDSketch, log-derived metrics as a primary path, flushing on `beforeunload`/`unload`, treating missing device APIs as `0`.

## Verification

1. `npm run dev:prepare` then `npm run test` — all new unit + nuxt-env tests green, existing suite untouched.
2. `npm run test:types` — module + playground typecheck.
3. **Inertness check**: bare install / `metrics` unset ⇒ no `/api/_frogger/metrics` route, no metrics plugin, no runtimeConfig keys, no singleton (grep the built playground output + hit the route expecting 404).
4. **End-to-end**: `npm run dev`, open the playground metrics demo page, interact + background the tab; verify `MetricObjectBatch` POSTs to `/api/_frogger/metrics` (network tab / Playwright capture), entries land in `logs/metrics/*.jsonl` with `trace.traceId` matching the page's log trace, and device context is transmitted once per batch, then denormalised onto each stored event at ingest (never into indexed `labels`).
5. (Dropped: the repo ships the `useFroggerMetricsCapture` fixture for consumers but has no Playwright runner/config/e2e specs itself; the `text/plain` beacon contract is covered by the nuxt-env ingest test. Budget a `playwright.config.ts` + `test:e2e` script as separate work if an in-repo e2e pass is wanted.)

## Constraints honored

- No git commits/pushes (developer-only).
- VitePress docs scope confirmed with the maintainer (new guide + sidebar entry).
- AGENTS.md + README + test files updated alongside the code.
- No em-dashes in code/docs authored for the repo (`src/runtime/metrics` cleaned; `docs/guides/metrics.md` still pending a maintainer-approved docs pass); comments only for non-obvious "why".
