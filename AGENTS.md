# AGENTS.md — Onboarding for AI assistants working on `nuxt-frogger`

> Purpose: get a fresh chat productive in minutes. This file is a factual map of the codebase, its
> architecture, its public API, and its known rough edges. Everything here is cross-checked against
> source; paths/line refs may drift as the code changes — verify before relying on a specific line.

## What Frogger is

`nuxt-frogger` is a **logging + W3C tracing module for Nuxt 3** (depends on `@nuxt/kit`/`nuxt` ^3.19). The pitch: log from anywhere —
server (Nitro), SSR, or client (CSR) — and every log lands in the same place. Client logs are
**batched and "beamed" back to the server** over HTTP. A bare install logs to **console only**;
persistent destinations are opt-in via declarative `transports` (rotated JSON-lines files with
`fileTransport()`, an external HTTP ingest with `httpTransport()`, or a nuxt-observe deployment with
`observeTransport()`), and logs can optionally be streamed to a dev WebSocket. Each logger instance is also a **trace span**, so logs from
one request/component are correlated, and trace context is propagated SSR→CSR and client→server using
the [W3C Trace Context](https://www.w3.org/TR/trace-context/) standard.

Package: `nuxt-frogger` (npm), built with `@nuxt/module-builder`, ESM-only, ships `dist/` only.
Target user (per [docs/why-frogger.md](docs/why-frogger.md)): solo devs / small teams who want a
zero-setup logger, not a distributed-microservice observability stack.

## Quick orientation

| Thing | Where |
| --- | --- |
| Module entry (`defineNuxtModule`) | [src/module.ts](src/module.ts) |
| Runtime code | [src/runtime/](src/runtime/) |
| Public types (logger interface) | [src/runtime/logger/types.ts](src/runtime/logger/types.ts) |
| Module options + defaults | [src/runtime/shared/types/module-options.ts](src/runtime/shared/types/module-options.ts), defaults inlined in [src/module.ts](src/module.ts#L31) |
| Docs (VitePress) | [docs/](docs/) |
| Tests (Vitest) | [test/](test/) |
| Dev sandbox | [playground/](playground/) |
| Testing helpers subpath (`nuxt-frogger/testing`) | [src/testing/index.ts](src/testing/index.ts) |
| Playwright fixtures subpath (`nuxt-frogger/playwright`) | [src/playwright/index.ts](src/playwright/index.ts) |
| Extra build entries for the subpaths | [build.config.ts](build.config.ts) |

Commands (pnpm lockfile present; scripts shell out to npm/nuxi):
- `npm run dev` — run the playground with the module linked.
- `npm run dev:prepare` — stub-build the module + prepare playground (run this after a fresh clone; CI runs it).
- `npm run test` / `npm run test:watch` — Vitest.
- `npm run test:types` — `vue-tsc --noEmit` for module + playground.
- `npm run prepack` — `nuxt-module-build build` (produces `dist/`).
- `npm run release` — test → build → `changelogen --release` → `npm publish` → push tags.
- `npm run docs:dev` — VitePress docs.

## Architecture — the log lifecycle

**Client / CSR path (the "beaming"):**
1. `useFrogger()` → `ClientFrogger` ([src/runtime/logger/client/index.ts](src/runtime/logger/client/index.ts)).
2. A log call runs through `BaseFroggerLogger.handleLog` ([src/runtime/logger/base-frogger.ts](src/runtime/logger/base-frogger.ts#L288)):
   build `LoggerObject` → optional scrub → emit to reporters (console) → `processLoggerObject`.
3. On the client, `processLoggerObject` enqueues into the client `LogQueueService`
   ([src/runtime/app/services/log-queue.ts](src/runtime/app/services/log-queue.ts)) — in-memory batching,
   retry with exponential backoff, 429-aware. The queue is resolved lazily and cached on the app via
   `getLogQueue(nuxtApp)` ([src/runtime/app/services/get-log-queue.ts](src/runtime/app/services/get-log-queue.ts)),
   NOT injected by a plugin — so `frogger.*` can never dereference an unready queue regardless of boot order.
   [src/runtime/app/plugins/log-queue.client.ts](src/runtime/app/plugins/log-queue.client.ts) (`enforce: 'pre'`)
   is now lifecycle-only: internal-log level, the `app:mounted` flag, and flush-on-`pagehide`.
   If the queue path throws, `processLoggerObject` falls back to a direct send and, only if that also fails,
   an **ungated** `console.error` — a customer log is never silently dropped.
   (During SSR, logs are sent immediately instead of queued.)
4. The queue POSTs a `LoggerObjectBatch` to **`/api/_frogger/logs`**.

**Server ingestion + storage path:**
5. Handler [src/runtime/server/api/logger.post.ts](src/runtime/server/api/logger.post.ts): size check →
   rate-limit ([src/runtime/rate-limiter/](src/runtime/rate-limiter/)) → loop detection (anti-feedback via
   `x-frogger-*` headers + batch `meta.processChain`) → `ServerLogQueueService.enqueueBatch`.
6. `ServerLogQueueService` (singleton, [src/runtime/server/services/server-log-queue.ts](src/runtime/server/services/server-log-queue.ts)):
   stamp each log's `source` from the batch envelope's `app` when it has none → scrub →
   `BatchTransport` (timestamp-sorted buffering) → fan-out to configured transports. The stamp is what
   lets a relay forward another app's logs without re-badging them as its own: `HttpTransport` rebuilds
   the envelope from the *relaying* app's identity, so per-log `source` is the only carrier that survives.
7. Transports ([src/runtime/logger/_transports/](src/runtime/logger/_transports/)) are built from the
   declarative `transports` list (server side) in `buildConfiguredTransports`: a `fileTransport()`
   entry → `FileTransport` (append + date/size rotation, dir defaults to `logs/`), any http/observe
   entry → `HttpTransport`. A bare install has none (console only). If the dev WebSocket is enabled,
   `WebSocketTransport` (live broadcast to subscribed peers, state persisted to Nitro KV) joins the
   fan-out. User array order is preserved.

**Server-side direct logging:** `getFrogger()` → `ServerFroggerLogger`
([src/runtime/logger/server/index.ts](src/runtime/logger/server/index.ts)) enqueues straight into
`ServerLogQueueService` (steps 6–7). It auto-captures the current H3 event via Nitro `asyncContext`
(`useEvent()`), reading incoming `traceparent`/`tracestate` so the first server log continues the
client's trace.

**Trace propagation:** `logger.getHeaders()` emits `traceparent` + `tracestate`. The
[trace-headers server plugin](src/runtime/server/plugins/trace-headers.server.ts) parses incoming
headers into `event.context.frogger`. Client↔server handoff means "last log on the client is the
parent of the first log on the server" (and vice-versa).

## Metrics subsystem (opt-in, fully parallel pipeline)

`nuxt-frogger` also has a **metrics** subsystem under [src/runtime/metrics/](src/runtime/metrics/). It
is **off by default**, opt-in via `metrics: true | MetricsOptions`, and **never part of a preset**
(like `transports`). It is a structural parallel of the log pipeline that shares **zero body types and
zero mutable state** with it: separate wire type ([`MetricObject`](src/runtime/metrics/shared/types/metric.ts)
/ [`MetricObjectBatch`](src/runtime/metrics/shared/types/metric-batch.ts)), separate ingest route
(`/api/_frogger/metrics`), separate queues, separate transport union + factories, and a separate
`globalThis.__FROGGER_METRICS_STORE__` capture registry. When metrics are off, **nothing** is emitted
(no plugin/route/runtime-config keys/singleton) — verified inert.

- **v1 collects**: Web Vitals (LCP/CLS/INP/FCP/TTFB → gauges `web.vital.*`, timings in **seconds**,
  CLS unitless) via the `web-vitals` dependency, plus a per-batch device/network envelope. No userland
  API yet (config-driven auto-collection).
- **Cardinality model**: `labels` = indexed dims (rating, route **pattern**), `attr` = non-indexed
  detail (id, delta, navigationType); device context rides the batch **once**. Raw events stored,
  **aggregate on read** — never pre-aggregate at ingest.
- **Client** ([metrics/app/](src/runtime/metrics/app/)): `MetricsQueueService` (lazy via
  `getMetricsQueue(nuxtApp)`, `$froggerMetricsQueue` cache key), `collector/web-vitals.ts` (dynamic
  `import('web-vitals')` — client-only) + `collector/device.ts`, `session.ts` (decide-once sampling in
  `sessionStorage`), `plugins/metrics.client.ts` (captures trace exemplar + route pattern once at init,
  flushes on `visibilitychange → hidden` + `pagehide` via `sendBeacon`).
- **Server** ([metrics/server/](src/runtime/metrics/server/)): `ServerMetricsQueueService` (singleton,
  no scrubber, **no aggregation** — raw fan-out), `api/metrics.post.ts` (**must** read `text/plain`
  beacon bodies via `readRawBody` + `JSON.parse`, not `readBody`; stamps `context.ua`), lifecycle
  plugin. No rate limiting in v1 (deferred with the limiter refactor).
- **Transports** ([metrics/_transports/](src/runtime/metrics/_transports/)): `IFroggerMetricsTransport`
  + `MetricsBatchTransport` (retyped `insertSorted`/`maxAge`/`maxSize`) + `MetricsFileTransport`
  (default dir `logs/metrics/`) + `MetricsMemoryTransport`. Factories `metricFileTransport()` /
  `metricMemoryTransport()` in [metrics/shared/transports/factories.ts](src/runtime/metrics/shared/transports/factories.ts),
  re-exported from [module.ts](src/module.ts) + [options.ts](src/runtime/options.ts).
- **Config**: `resolveMetricsOptions()` in [metrics/shared/utils/resolve-metrics.ts](src/runtime/metrics/shared/utils/resolve-metrics.ts)
  (reuses the now-exported `normalizeToggle`); distinct server/client batch defaults
  (`DEFAULT_METRICS_BATCH` maxAge 15000 vs `DEFAULT_METRICS_PUBLIC_BATCH` maxAge 5000). Resolved into
  `ResolvedFroggerOptions.metrics: ResolvedMetricsOptions | false`; runtimeConfig split
  `public.frogger.metrics` (client) vs `frogger.metrics` (server transports) — present only when on.
- **Testing**: [src/testing/index.ts](src/testing/index.ts) adds `getCapturedMetrics({ store, ...matcher })`
  (store key is `store`, since `name` is the metric name), `clearCapturedMetrics`, `filterMetrics`,
  `flushFroggerMetrics`; [src/playwright/index.ts](src/playwright/index.ts) adds
  `useFroggerMetricsCapture(page)` (reads `postData()` — beacons are `text/plain`).

## Directory guide (`src/runtime/`)

| Dir | What lives here | Start at |
| --- | --- | --- |
| `logger/` | Abstract base + client/server loggers; the `IFroggerLogger` contract | [base-frogger.ts](src/runtime/logger/base-frogger.ts), [types.ts](src/runtime/logger/types.ts) |
| `logger/_transports/` | `base`, `batch`, `file`, `http`, `memory`, `websocket` transports | [file-transport.ts](src/runtime/logger/_transports/file-transport.ts) |
| `logger/_reporters/` | Console reporter (terminal/devtools output) | [console-reporter.ts](src/runtime/logger/_reporters/console-reporter.ts) |
| `logger/other/` | `console-frogger`, `test-frogger` (lightweight variants) | [console-frogger.ts](src/runtime/logger/other/console-frogger.ts) |
| `app/` | Client composables, the client log queue, client plugins | [composables/useFrogger.ts](src/runtime/app/composables/useFrogger.ts) |
| `server/` | Ingest API, server log queue service, server plugins, `getFrogger` utils | [api/logger.post.ts](src/runtime/server/api/logger.post.ts) |
| `websocket/` | Dev WS handler, log handler, KV state layer, deduplicator | [log-handler.ts](src/runtime/websocket/log-handler.ts), [state/index.ts](src/runtime/websocket/state/index.ts) |
| `scrubber/` | Sensitive-data redaction engine (regex rules, priorities, caching) | [index.ts](src/runtime/scrubber/index.ts) |
| `rate-limiter/` | Multi-tier rate limiting + KV layer + escalating blocks | [index.ts](src/runtime/rate-limiter/index.ts) |
| `app-info/` | Parse `app` option into `{ name, version }` | [parse.ts](src/runtime/app-info/parse.ts) |
| `shared/types/` | `LoggerObject`, `LoggerObjectBatch`, options, trace types | [log.ts](src/runtime/shared/types/log.ts), [batch.ts](src/runtime/shared/types/batch.ts) |
| `shared/utils/` | Trace headers, log-level parser, uuid (v7), config loader, resolver, batch splitter | [resolve-options.ts](src/runtime/shared/utils/resolve-options.ts), [split-batch.ts](src/runtime/shared/utils/split-batch.ts) |
| `shared/transports/` | Declarative transport factories (`fileTransport`/`httpTransport`/`observeTransport`/`memoryTransport`) | [factories.ts](src/runtime/shared/transports/factories.ts) |
| `options.ts` | Re-exports `defineFroggerOptions` + transport factories (the `#frogger/config` alias) | [options.ts](src/runtime/options.ts) |

## Public API

**Client (auto-imported composables):**
- `useFrogger(options?: ClientLoggerOptions): IFroggerLogger` — main logger factory (fresh instance = fresh span).
- `frogger` — auto-imported **ambient** logger; a drop-in for `console.*` (variadic `log`/`info`/`warn`/`error`/`debug`/… plus `getHeaders`/`child`/`span`/`startSpan`/etc.). Backed by ONE app-scoped `ClientFrogger` (single span chain); inside `frogger.span(...)` it resolves to the active span's child instead. Impl: [app/frogger.ts](src/runtime/app/frogger.ts) (`getAmbientClientLogger`); shared facade [logger/ambient.ts](src/runtime/logger/ambient.ts); arg reconciliation [shared/utils/normalize-log-args.ts](src/runtime/shared/utils/normalize-log-args.ts) (trailing plain object → `ctx`, leading args → `msg`, `Error` → `ctx.error`). **Boot-context:** on first construction it stamps the static `context` object from `frogger.config.ts` (serialized into `public.frogger.context`), then fires the one-time `frogger:init` Nuxt hook with the logger so a client plugin can add dynamic base context (`frogger.addContext(...)`) that can't be serialized. The server ambient logger applies the same static `context` (per-request; no `frogger:init` hook there).
- `useFroggerWebSocket()` — fluent dev-only live-log subscriber (`.channel().levels().types().sources().tags().onMessage().connect()`). Only registered when `websocket` **and** `serverModule` are enabled.

**Server (auto-imported, Nitro):**
- `getFrogger(options?, event?): IFroggerLogger` — when `autoEventCapture` is on (default), the event is grabbed via `useEvent()`; otherwise pass it explicitly. NOTE the overload order differs between the two impls (see rough edges). Inside `frogger.span(...)` it returns a child of the active span logger (continues the tree) instead of re-branching from the request root.
- `frogger` — auto-imported **ambient** logger; same drop-in `console.*` surface, backed by ONE per-request `ServerFroggerLogger` cached on `event.context.froggerAmbientLogger` (resolved via `useEvent()`, single span chain, trace-correlated with the client). Impl: [server/utils/frogger.ts](src/runtime/server/utils/frogger.ts). Resolution order: active span logger (see `span` below) → per-request cache → process-scoped fallback (outside a request / when `autoEventCapture` is off).
- `HttpTransport` — class for forwarding logs to an external HTTP endpoint. Options gained `apiKeyLocation` (`'header'` default → `x-api-key`, `'query'` → `?key=`), `maxBatchEvents`/`maxBodyBytes` (outgoing batch splitting via [shared/utils/split-batch.ts](src/runtime/shared/utils/split-batch.ts)). Its retry loop is now live (see rough edges — the old body silently swallowed all send failures).
- `addGlobalTransport(transport)` / `createHttpTransport(endpoint|options)` — imperative transport registration ([server/utils/transport.ts](src/runtime/server/utils/transport.ts)).

**Declarative transport config** (importable from `#frogger/config` in `frogger.config.ts`, or from `nuxt-frogger` in `nuxt.config`; pure factories, no `#imports` — [shared/transports/factories.ts](src/runtime/shared/transports/factories.ts)):
- `fileTransport(options?)` → `{ type: 'file', ... }` — server-only rotated JSON-lines files. **The only way to enable file logging** (no longer a default).
- `httpTransport(options)` → `{ type: 'http', ... }` — a generic HTTP ingest destination.
- `observeTransport({ url, key, client?, server? })` → `{ type: 'observe', ... }` — a nuxt-observe deployment; the resolver expands it to the observe ingest contract (path `/api/observe/ingest/frogger`, `x-api-key` server-side, `?key=` browser-side, 500-event / ~950 KiB caps).
- `memoryTransport({ name?, server?, client? })` → `{ type: 'memory', ... }` — server-only in-memory capture for tests. `MemoryTransport` ([memory-transport.ts](src/runtime/logger/_transports/memory-transport.ts)) pushes every log into an array; a `name` shares that array through a `globalThis.__FROGGER_MEMORY_STORE__` registry so `getCapturedLogs({ name })` from `nuxt-frogger/testing` reads the same captures. `client: true` warns and is ignored (server-only for v1, matching `file`).
- Each factory returns a plain serializable tagged object (survives `structuredClone` / `runtimeConfig`). The resolver ([resolve-options.ts](src/runtime/shared/utils/resolve-options.ts)) switches on `type` (untagged = `http`, backward compat) and splits entries into `transports.server` (`ResolvedServerTransport` union of file + http + memory) and `transports.client` (`ResolvedHttpTransport`). Untagged `{ url, apiKey }` objects still work.

**Testing subpaths** (not auto-imported; imported directly by test files, packaged as separate `dist/` entries via [build.config.ts](build.config.ts); the tooling deps are optional peers):
- `nuxt-frogger/testing` ([src/testing/index.ts](src/testing/index.ts)) — Vitest helpers built on the memory transport. Pure at import time (Nuxt `#imports` and `vitest` are reached only via dynamic import). Exports `MemoryTransport`/`memoryTransport` (re-export), `getCapturedLogs(opts?)` + `clearCapturedLogs(name?)` (read/clear the named registry store), `filterLogs(logs, matcher)` (the shared `{ level, type, msg, ctx, traceId }` predicate), `flushFrogger()` (drains `ServerLogQueueService` — pair with `batch: false`), `registerFroggerMatchers()` (opt-in `expect.extend({ toHaveLogged })` + a `vitest` type augmentation), and `froggerTestRuntimeConfig()`/`stubFroggerFetch()` (the `useRuntimeConfig()` value + `$fetch` stub the in-repo `*.nuxt.test.ts` files build by hand — note `mockNuxtImport` is a compile-time macro that must stay at the test-file top level).
- `nuxt-frogger/playwright` ([src/playwright/index.ts](src/playwright/index.ts)) — Playwright fixtures. Imports only `@playwright/test` + the pure `filterLogs`. Exports `FROGGER_INTERNAL_PREFIX` (the stable `🐸 Frogger` tripwire string from [internal-log.ts](src/runtime/shared/utils/internal-log.ts)), `useFroggerCapture(page, opts?)` (routes the client→server batch POSTs, `route.continue()`s, and exposes `getLogs`/`getBatches`/`waitForLog`/`expectLog`/`clear`), and an extended `test`/`expect` with a `froggerCapture` fixture plus an opt-in `failOnFroggerInternalErrors` tripwire fixture.
- Cross-dir imports in these two files carry explicit `.js` extensions on purpose: mkdist leaves out-of-entry specifiers verbatim, and the built output must resolve under plain Node ESM (Playwright loads it that way).

**The logger contract** — [`IFroggerLogger`](src/runtime/logger/types.ts) (identical on client + server):
- Levels (consola-based): `fatal`/`error` (0), `warn` (1), `log` (2), `info`/`success`/`fail`/`ready`/`start` (3), `debug` (4), `trace` (5), plus `silent` (-999), `verbose` (999), and dynamic `logLevel(type, msg, ctx)`.
- Context: `addContext(ctx, { overwrite? })` / `setContext` / `clearContext`. `addContext` deep-merges via `defu`; incoming wins on key conflicts by default (`defu(ctx, existing)`, last-write-wins) so re-stamped keys like `route`/`user` update instead of freezing, and `{ overwrite: false }` flips to `defu(existing, ctx)` (fill only unset keys). `setContext` replaces wholesale; `clearContext` empties.
- Children: `child(options)` (snapshot context; explicitly passed `context` keys override inherited ones) and `reactiveChild(options)` (live-inherits parent context via a Vue `computed`).
- Spans: `span(name, fn)` runs `fn` with a named child installed as the **active logger** — every ambient `frogger.*` call (and `getFrogger()`) inside `fn`, however deeply nested, resolves to that child, so logs auto-nest under the span; restored on exit, nestable, concurrency-safe on the server. `startSpan(name, options?)` returns the same named child (with `ctx.span = name`) to hold and pass around manually, without changing the active logger. `span()` also emits ONE **span-end event** per span (msg = span name, `ctx.spanEvent: 'end'`, `durationMs`, `ok`), OTel-style, so a span is visible even when nothing logs inside it; configured by the `spans` module option (default `{ level: 'info' }`, `false` disables). The thrown error is never attached to the event. Impl: [shared/utils/span-events.ts](src/runtime/shared/utils/span-events.ts); tests: the span-end describe in [test/logger/span-parentage.nuxt.test.ts](test/logger/span-parentage.nuxt.test.ts). Mechanism: [logger/active-context.server.ts](src/runtime/logger/active-context.server.ts) (`AsyncLocalStorage` from `node:async_hooks`) / [logger/active-context.client.ts](src/runtime/logger/active-context.client.ts) (module variable, best-effort under interleaved async). The `.server` file must NEVER be imported (even transitively) from client-bundled code — impl is selected by import site.
- Reporters: `addReporter` / `removeReporter` / `getReporters` / `clearReporters`.
- Tracing: `getHeaders(customVendor?)`. Plus `reset()`.

**Signature:** `info(message: string, context?: object)` — message first (a static human string), context object second (dynamic data). The emitted record is `LoggerObject` ([src/runtime/shared/types/log.ts](src/runtime/shared/types/log.ts)): `{ time, lvl, type, msg, ctx, tags?, env, source?, trace }`. `ctx` is typed `Record<string, any>` (untyped).

## Configuration

Sources, in precedence order: `frogger.config.ts` > `nuxt.config` `frogger` key > defaults.
1. `frogger.config.ts` at project root via `defineFroggerOptions({...})` (imported from `#frogger/config`). Loaded by [src/runtime/shared/utils/frogger-config.ts](src/runtime/shared/utils/frogger-config.ts); dev watches it and hard-restarts on change.
2. The `frogger` key in `nuxt.config.ts`.
3. Defaults + preset expansion — **all** owned by `resolveFroggerOptions` in [src/runtime/shared/utils/resolve-options.ts](src/runtime/shared/utils/resolve-options.ts). The `defineNuxtModule` `defaults` block is intentionally **empty** so the resolver can tell user-set keys apart from defaults (see C1/C2 note below). setup() does `defu(froggerConfig, nuxtConfig)` then `resolveFroggerOptions(...)`.

`ModuleOptions` top-level keys ([src/runtime/shared/types/module-options.ts](src/runtime/shared/types/module-options.ts)):
`preset` (`'minimal' | 'standard' | 'full'`, default `minimal`), `clientModule`, `serverModule` (`{ autoEventCapture }`),
`app` (string | `{ name, version }`), `transports` (`FroggerTransportConfig[]`), `batch`, `rateLimit`, `websocket`, `scrub`,
`errorCapture` (`boolean | { client, server }`), `consoleOutput` (`boolean | { client, server }`, default
`true`/`true` — mirrors *application* logs to the console; not preset-controlled), and `public` (`endpoint` — `string | false`, `false`
disables the client POST to the app's own route; `baseUrl`, `batch`). Minimal config is just adding
`'nuxt-frogger'` to `modules` — that yields **console only** (preset `minimal`, no persistent
transport). File logging and remote forwarding are opt-in via `transports` (see invariants below).

**Removed:** the top-level `file` module option (hard-removed). Use `fileTransport({...})` in
`transports` instead; the resolver warns if a legacy `file` key is still present. `runtimeConfig.frogger.file`
is gone too (nothing consumed it in the `getFrogger` utils — those reads were dead weight and were dropped).

## Key invariants & gotchas (read before changing behavior)

- **Ingest route is `/api/_frogger/logs`** (registered in [src/module.ts](src/module.ts#L339)). The default public `endpoint` constant points at it; the route stays registered even when `public.endpoint: false` disables the client POST (server-side `getFrogger`/relay still works).
- **File logging is opt-in.** A bare install constructs NO `FileTransport` and writes no `logs/` directory — logs go to console only. Add `fileTransport()` to `transports` to restore file behaviour. When `transports.server` and `transports.client` are both empty, the module emits a one-time dev warning that logs aren't persisted (skippable if you register a transport imperatively via `addGlobalTransport()`).
- **Presets never controlled file logging.** `FROGGER_PRESETS` only toggle scrub/rateLimit/websocket/errorCapture; the minimal→full ladder is orthogonal to `transports`.
- **Console output and transport delivery are independent paths.** The `ConsoleReporter` is registered via `addReporter()` (so it shows up in `getReporters()`); the batch/transport path is a *separate* consola reporter added directly in the `BaseFroggerLogger` constructor and never enters `customReporters`. Silencing the console therefore cannot drop a log from a transport. `consoleOutput` resolves as **per-logger option > module config > `true`** — note `?? ` semantics, not `!== false`, so an explicit per-logger `true` can re-enable the console under a module-wide `false`.
- **Never hardcode `consoleOutput` into a logger's inherited `this.options`.** `ClientFrogger.createChild` builds children from `defu(options, this.options)`, so any literal placed there becomes an *explicit* per-logger value on every child, span and `startSpan` — outranking the module config. `ClientFrogger` must copy the already-resolved `this.consoleOutput` (assigned by the base constructor) *after* the `...options` spread. Regression coverage: [test/logger/console-output.nuxt.test.ts](test/logger/console-output.nuxt.test.ts).
- **`import.meta.server` is the wrong client/server discriminator for loggers.** `ClientFrogger` also runs during the SSR render pass. Which side of a per-runtime option applies is decided by `BaseFroggerLogger.getConsoleScope()`, overridden in `ServerFroggerLogger`. It is called from the base constructor, so it resolves off the prototype and must not touch subclass fields.
- **One logger instance = one trace span.** Docs explicitly tell users *not* to share a single logger app-wide; create one per component/route/util ([docs/getting-started.md](docs/getting-started.md#L451)). Span/parent IDs advance per log via `generateTraceContext` ([base-frogger.ts](src/runtime/logger/base-frogger.ts#L105)).
- **The live-stream WebSocket handler is registered ONLY in dev** ([src/module.ts](src/module.ts#L345)). There is no production log-reading path — storage is rotated JSON-lines files on disk; there is no query/search API and no viewer UI.
- **Heavy subsystems are OPT-IN (as of Theme C1/C2)**: rate-limiter, scrubber, websocket (the experimental Nitro `websocket` flag + dev handler), and client+server global error capture are **off** unless enabled (`true`/object, or via `preset: 'standard'`/`'full'`). A bare install / `preset: 'minimal'` = console + client+server batching only (no persistent transport). The resolver normalizes each subsystem to `false`-or-full-object; `preset: 'full'` reproduces the old always-on behaviour. When off, a subsystem registers no plugin/handler/flag and constructs no singleton. (Note: client+server **batching** is core and stays on.)
- **Per-logger `scrub` overrides module config** ([base-frogger.ts](src/runtime/logger/base-frogger.ts#L53)): `scrub: false` disables scrubbing for that logger, a `ScrubberOptions` object **replaces** the module rules wholesale (compose module rules back in explicitly via `defineScrub().use(...)`), and `true`/unset inherits the module config. In `createChild` (both runtimes) child options win over the parent's via `defu(options, this.options)`, EXCEPT `scrub`, which is replaced rather than defu-merged — defu would concatenate the two configs' rule arrays. In `getFrogger`/`useFrogger`, caller options win over runtime config. Regression tests: [test/logger/scrub-options.nuxt.test.ts](test/logger/scrub-options.nuxt.test.ts).
- **The scrubber NEVER mutates the caller's data** ([scrubber/index.ts](src/runtime/scrubber/index.ts) `scrubValue`). `createLoggerObject` only shallow-spreads `ctx`, so nested objects and persisted global-context values are still shared references with the developer's object. `scrubValue` therefore copies-on-write: an unchanged subtree is returned by reference (shared), and only the spine of nodes leading to a redacted value is shallow-cloned (prototype-preserving); `scrubLoggerObject` then swaps the scrubbed copy into `logObj.ctx`. This fixed a bug where redaction leaked back into the object passed to the logger (and stuck permanently on global context). Cycle-safe via a per-call `WeakSet`. Regression tests: the "Never mutates the caller input" block in [test/scrubber.test.ts](test/scrubber.test.ts).
- **Errors in ctx are flattened before scrub/transport** ([shared/utils/normalize-errors.ts](src/runtime/shared/utils/normalize-errors.ts), applied in both `createLoggerObject`s). `Error` fields are non-enumerable, so without this `{ error: err }` JSON-serialises to `{}` at the transport. The walk is copy-on-write (caller's graph never mutated), cycle-safe, keeps enumerable own props (pg/ofetch `code`/`statusCode`), serialises `cause` chains depth-bounded, and stamps each Error (non-enumerable symbol) as already-logged. The ambient positional-Error path reuses the same serialiser.
- **Server error capture dedupes by default** (`errorCapture.server.dedupe`, default `true`): the Nitro `error` hook skips an error (or an `H3Error` whose `cause`) already stamped as logged by a handler's own catch, so a caught-and-logged error is reported once, with the handler's richer context winning.
- **Scrub rule `priority` decides across BOTH pattern kinds** (exact string vs regex); an exact match wins only ties ([scrubber/index.ts](src/runtime/scrubber/index.ts) `findRule`). Before v0.2 an exact match beat any regex regardless of priority. Tests: the "Priority across pattern kinds" block in [test/scrubber.test.ts](test/scrubber.test.ts).
- **Shutdown/crash paths drain, never sleep.** `BatchTransport.flush()` deliberately holds back logs younger than `sortingWindowMs`; `BatchTransport.drain()` / `ServerLogQueueService.drain()` bypass that and empty everything (then force-flush downstream transports). `uncaughtException`, SIGTERM/SIGINT (global-error plugin) and the Nitro `close` hook (log-queue plugin) all await `drain()` (time-capped) before exiting — previously they slept a fixed 0.5-1s without flushing, so fatal lines died in the 15s batch buffer.
- **Singletons + lazy init**: `ServerLogQueueService` and `WebSocketTransport` are process singletons; the WS KV state layer loads lazily and degrades gracefully to `null` if `useStorage()` isn't ready.
- **Experimental Nitro flags** are enabled by the module: `asyncContext` (for `getFrogger()` event capture) and `tasks`; `websocket` when WS is on ([src/module.ts](src/module.ts#L222)).

## Known rough edges (so you don't trip over them)

These are the current pain points; an improvement plan lives in [ROADMAP.md](ROADMAP.md).
- ~~**Console noise**~~ / ~~**Build/startup spam**~~ — **RESOLVED (Theme A)**. All internal `console.*` diagnostics now route through a leveled internal channel ([shared/utils/internal-log.ts](src/runtime/shared/utils/internal-log.ts), `froggerInternal.error/warn/info/debug`), gated by the `verbose` / `logLevel` module options (default `warn` in dev, `silent` in production). The `🐸 FROGGER` build banners are gated too: dev prints **one** "Ready to log" line, production prints nothing. NOTE: the `ConsoleReporter` and the `console-frogger` fallback still call `console.*` directly — that is the user's *log output* (product), not internal chatter, so it is NOT gated by `verbose`/`logLevel`. It is instead gated by the separate `consoleOutput` module option (see below). When adding new runtime diagnostics, use `froggerInternal.*`, not `console.*`.
- **Type debt:** ~63 `@ts-ignore`/`@ts-expect-error`, concentrated around untyped `useRuntimeConfig()` access ([src/module.ts](src/module.ts#L186), the `getFrogger` utils, `base-frogger`). `LogContext` / WS payloads are `any`.
- **Duplication:** [server/utils/auto.ts](src/runtime/server/utils/auto.ts) and [server/utils/manual.ts](src/runtime/server/utils/manual.ts) have effectively identical bodies; only the public overload arg-order differs (`(options?, event?)` vs `(event?, options?)`).
- **Misleading dead code (not a runtime bug):** `ServerFroggerLogger.createChild` sets `spanId: parentSpanId` ([server/index.ts](src/runtime/logger/server/index.ts#L103)), but `generateTraceContext` only consumes `traceId`/`parentId` and always mints a fresh `spanId` — so that field is never read.
- ~~**HttpTransport silently swallowed send failures**~~ — **RESOLVED**. `performHttpRequest` caught every error and only logged `H3Error` (which `$fetch` never throws — it throws `FetchError`), never rethrowing, so `handleSendFailure` (the whole retry machinery) was dead code. It now rethrows; `sendChunk`/`handleSendFailure` classify: a non-429 4xx drops immediately (deterministic client error), 429/5xx/network back off up to `maxRetries`. Behavioral change (silent drop → retry-then-drop); covered by tests.
- **Test coverage is uneven:** strong on parsers/scrubber/websocket/trace utils and now the resolver/transports/split-batch/memory-transport (+ the `toHaveLogged` matcher and the memory fan-out in the server-queue nuxt test); still thin on the core logger classes (the scrub/option-precedence paths now have [scrub-options.nuxt.test.ts](test/logger/scrub-options.nuxt.test.ts)) and the end-to-end client→server flow.

## Conventions

- 2-space indent, LF, ESM, TypeScript. ESLint via `@nuxt/eslint-config` flat config ([eslint.config.mjs](eslint.config.mjs)).
- Class-based runtime with abstract `BaseFroggerLogger`; transports/reporters implement small interfaces.
- Commits: Conventional Commits (drives `changelogen`). Releases are `chore(release): vX.Y.Z`.
- When you add runtime files, remember they must be wired in [src/module.ts](src/module.ts) (auto-imports, plugins, server handlers) to be exposed.
