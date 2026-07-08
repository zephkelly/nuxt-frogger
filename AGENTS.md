# AGENTS.md — Onboarding for AI assistants working on `nuxt-frogger`

> Purpose: get a fresh chat productive in minutes. This file is a factual map of the codebase, its
> architecture, its public API, and its known rough edges. Everything here is cross-checked against
> source; paths/line refs may drift as the code changes — verify before relying on a specific line.

## What Frogger is

`nuxt-frogger` is a **logging + W3C tracing module for Nuxt 3** (depends on `@nuxt/kit`/`nuxt` ^3.19). The pitch: log from anywhere —
server (Nitro), SSR, or client (CSR) — and every log lands in the same place. Client logs are
**batched and "beamed" back to the server** over HTTP, then written to rotated JSON-lines files (and
optionally streamed to a dev WebSocket). Each logger instance is also a **trace span**, so logs from
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
   retry with exponential backoff, 429-aware. Registered as `nuxtApp.$logQueue` by
   [src/runtime/app/plugins/log-queue.client.ts](src/runtime/app/plugins/log-queue.client.ts).
   (During SSR, logs are sent immediately instead of queued.)
4. The queue POSTs a `LoggerObjectBatch` to **`/api/_frogger/logs`**.

**Server ingestion + storage path:**
5. Handler [src/runtime/server/api/logger.post.ts](src/runtime/server/api/logger.post.ts): size check →
   rate-limit ([src/runtime/rate-limiter/](src/runtime/rate-limiter/)) → loop detection (anti-feedback via
   `x-frogger-*` headers + batch `meta.processChain`) → `ServerLogQueueService.enqueueBatch`.
6. `ServerLogQueueService` (singleton, [src/runtime/server/services/server-log-queue.ts](src/runtime/server/services/server-log-queue.ts)):
   scrub → `BatchTransport` (timestamp-sorted buffering) → fan-out to transports.
7. Transports ([src/runtime/logger/_transports/](src/runtime/logger/_transports/)):
   `FileTransport` (append + date/size rotation, dir defaults to `logs/`) and, if enabled,
   `WebSocketTransport` (live broadcast to subscribed peers, state persisted to Nitro KV).

**Server-side direct logging:** `getFrogger()` → `ServerFroggerLogger`
([src/runtime/logger/server/index.ts](src/runtime/logger/server/index.ts)) enqueues straight into
`ServerLogQueueService` (steps 6–7). It auto-captures the current H3 event via Nitro `asyncContext`
(`useEvent()`), reading incoming `traceparent`/`tracestate` so the first server log continues the
client's trace.

**Trace propagation:** `logger.getHeaders()` emits `traceparent` + `tracestate`. The
[trace-headers server plugin](src/runtime/server/plugins/trace-headers.server.ts) parses incoming
headers into `event.context.frogger`. Client↔server handoff means "last log on the client is the
parent of the first log on the server" (and vice-versa).

## Directory guide (`src/runtime/`)

| Dir | What lives here | Start at |
| --- | --- | --- |
| `logger/` | Abstract base + client/server loggers; the `IFroggerLogger` contract | [base-frogger.ts](src/runtime/logger/base-frogger.ts), [types.ts](src/runtime/logger/types.ts) |
| `logger/_transports/` | `base`, `batch`, `file`, `http`, `websocket` transports | [file-transport.ts](src/runtime/logger/_transports/file-transport.ts) |
| `logger/_reporters/` | Console reporter (terminal/devtools output) | [console-reporter.ts](src/runtime/logger/_reporters/console-reporter.ts) |
| `logger/other/` | `console-frogger`, `test-frogger` (lightweight variants) | [console-frogger.ts](src/runtime/logger/other/console-frogger.ts) |
| `app/` | Client composables, the client log queue, client plugins | [composables/useFrogger.ts](src/runtime/app/composables/useFrogger.ts) |
| `server/` | Ingest API, server log queue service, server plugins, `getFrogger` utils | [api/logger.post.ts](src/runtime/server/api/logger.post.ts) |
| `websocket/` | Dev WS handler, log handler, KV state layer, deduplicator | [log-handler.ts](src/runtime/websocket/log-handler.ts), [state/index.ts](src/runtime/websocket/state/index.ts) |
| `scrubber/` | Sensitive-data redaction engine (regex rules, priorities, caching) | [index.ts](src/runtime/scrubber/index.ts) |
| `rate-limiter/` | Multi-tier rate limiting + KV layer + escalating blocks | [index.ts](src/runtime/rate-limiter/index.ts) |
| `app-info/` | Parse `app` option into `{ name, version }` | [parse.ts](src/runtime/app-info/parse.ts) |
| `shared/types/` | `LoggerObject`, `LoggerObjectBatch`, options, trace types | [log.ts](src/runtime/shared/types/log.ts), [batch.ts](src/runtime/shared/types/batch.ts) |
| `shared/utils/` | Trace headers, log-level parser, uuid (v7), config loader | [trace-headers.ts](src/runtime/shared/utils/trace-headers.ts) |
| `options.ts` | Re-exports `defineFroggerOptions` (the `#frogger/config` alias) | [options.ts](src/runtime/options.ts) |

## Public API

**Client (auto-imported composables):**
- `useFrogger(options?: ClientLoggerOptions): IFroggerLogger` — main logger factory (fresh instance = fresh span).
- `frogger` — auto-imported **ambient** logger; a drop-in for `console.*` (variadic `log`/`info`/`warn`/`error`/`debug`/… plus `getHeaders`/`child`/`span`/`startSpan`/etc.). Backed by ONE app-scoped `ClientFrogger` (single span chain); inside `frogger.span(...)` it resolves to the active span's child instead. Impl: [app/frogger.ts](src/runtime/app/frogger.ts); shared facade [logger/ambient.ts](src/runtime/logger/ambient.ts); arg reconciliation [shared/utils/normalize-log-args.ts](src/runtime/shared/utils/normalize-log-args.ts) (trailing plain object → `ctx`, leading args → `msg`, `Error` → `ctx.error`).
- `useFroggerWebSocket()` — fluent dev-only live-log subscriber (`.channel().levels().types().sources().tags().onMessage().connect()`). Only registered when `websocket` **and** `serverModule` are enabled.

**Server (auto-imported, Nitro):**
- `getFrogger(options?, event?): IFroggerLogger` — when `autoEventCapture` is on (default), the event is grabbed via `useEvent()`; otherwise pass it explicitly. NOTE the overload order differs between the two impls (see rough edges). Inside `frogger.span(...)` it returns a child of the active span logger (continues the tree) instead of re-branching from the request root.
- `frogger` — auto-imported **ambient** logger; same drop-in `console.*` surface, backed by ONE per-request `ServerFroggerLogger` cached on `event.context.froggerAmbientLogger` (resolved via `useEvent()`, single span chain, trace-correlated with the client). Impl: [server/utils/frogger.ts](src/runtime/server/utils/frogger.ts). Resolution order: active span logger (see `span` below) → per-request cache → process-scoped fallback (outside a request / when `autoEventCapture` is off).
- `HttpTransport` — class for forwarding logs to an external HTTP endpoint.

**The logger contract** — [`IFroggerLogger`](src/runtime/logger/types.ts) (identical on client + server):
- Levels (consola-based): `fatal`/`error` (0), `warn` (1), `log` (2), `info`/`success`/`fail`/`ready`/`start` (3), `debug` (4), `trace` (5), plus `silent` (-999), `verbose` (999), and dynamic `logLevel(type, msg, ctx)`.
- Context: `addContext` / `setContext` / `clearContext`.
- Children: `child(options)` (snapshot context; explicitly passed `context` keys override inherited ones) and `reactiveChild(options)` (live-inherits parent context via a Vue `computed`).
- Spans: `span(name, fn)` runs `fn` with a named child installed as the **active logger** — every ambient `frogger.*` call (and `getFrogger()`) inside `fn`, however deeply nested, resolves to that child, so logs auto-nest under the span; restored on exit, nestable, concurrency-safe on the server. `startSpan(name, options?)` returns the same named child (with `ctx.span = name`) to hold and pass around manually, without changing the active logger. Mechanism: [logger/active-context.server.ts](src/runtime/logger/active-context.server.ts) (`AsyncLocalStorage` from `node:async_hooks`) / [logger/active-context.client.ts](src/runtime/logger/active-context.client.ts) (module variable, best-effort under interleaved async). The `.server` file must NEVER be imported (even transitively) from client-bundled code — impl is selected by import site.
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
`app` (string | `{ name, version }`), `file`, `batch`, `rateLimit`, `websocket`, `scrub`,
`errorCapture` (`boolean | { client, server }`), and `public` (`endpoint`, `baseUrl`, `batch`). Minimal
config is just adding `'nuxt-frogger'` to `modules` — but as of C1/C2 that yields **file + console only**
(preset `minimal`); the heavy subsystems are opt-in (see invariants below).

## Key invariants & gotchas (read before changing behavior)

- **Ingest route is `/api/_frogger/logs`** (registered in [src/module.ts](src/module.ts#L339)). The default public `endpoint` constant points at it.
- **One logger instance = one trace span.** Docs explicitly tell users *not* to share a single logger app-wide; create one per component/route/util ([docs/getting-started.md](docs/getting-started.md#L451)). Span/parent IDs advance per log via `generateTraceContext` ([base-frogger.ts](src/runtime/logger/base-frogger.ts#L105)).
- **The live-stream WebSocket handler is registered ONLY in dev** ([src/module.ts](src/module.ts#L345)). There is no production log-reading path — storage is rotated JSON-lines files on disk; there is no query/search API and no viewer UI.
- **Heavy subsystems are OPT-IN (as of Theme C1/C2)**: rate-limiter, scrubber, websocket (the experimental Nitro `websocket` flag + dev handler), and client+server global error capture are **off** unless enabled (`true`/object, or via `preset: 'standard'`/`'full'`). A bare install / `preset: 'minimal'` = file + console + client+server batching only. The resolver normalizes each subsystem to `false`-or-full-object; `preset: 'full'` reproduces the old always-on behaviour. When off, a subsystem registers no plugin/handler/flag and constructs no singleton. (Note: client+server **batching** is core and stays on.)
- **Singletons + lazy init**: `ServerLogQueueService` and `WebSocketTransport` are process singletons; the WS KV state layer loads lazily and degrades gracefully to `null` if `useStorage()` isn't ready.
- **Experimental Nitro flags** are enabled by the module: `asyncContext` (for `getFrogger()` event capture) and `tasks`; `websocket` when WS is on ([src/module.ts](src/module.ts#L222)).

## Known rough edges (so you don't trip over them)

These are the current pain points; an improvement plan lives in [ROADMAP.md](ROADMAP.md).
- ~~**Console noise**~~ / ~~**Build/startup spam**~~ — **RESOLVED (Theme A)**. All internal `console.*` diagnostics now route through a leveled internal channel ([shared/utils/internal-log.ts](src/runtime/shared/utils/internal-log.ts), `froggerInternal.error/warn/info/debug`), gated by the `verbose` / `logLevel` module options (default `warn` in dev, `silent` in production). The `🐸 FROGGER` build banners are gated too: dev prints **one** "Ready to log" line, production prints nothing. NOTE: the `ConsoleReporter` and the `console-frogger` fallback still call `console.*` directly — that is the user's *log output* (product), not internal chatter, so it is intentionally NOT gated. When adding new runtime diagnostics, use `froggerInternal.*`, not `console.*`.
- **Type debt:** ~63 `@ts-ignore`/`@ts-expect-error`, concentrated around untyped `useRuntimeConfig()` access ([src/module.ts](src/module.ts#L186), the `getFrogger` utils, `base-frogger`). `LogContext` / WS payloads are `any`.
- **Duplication:** [server/utils/auto.ts](src/runtime/server/utils/auto.ts) and [server/utils/manual.ts](src/runtime/server/utils/manual.ts) have effectively identical bodies; only the public overload arg-order differs (`(options?, event?)` vs `(event?, options?)`).
- **Misleading dead code (not a runtime bug):** `ServerFroggerLogger.createChild` sets `spanId: parentSpanId` ([server/index.ts](src/runtime/logger/server/index.ts#L103)), but `generateTraceContext` only consumes `traceId`/`parentId` and always mints a fresh `spanId` — so that field is never read.
- **Test coverage is uneven:** strong on parsers/scrubber/websocket/trace utils; thin on the core logger classes, transports, and the end-to-end client→server flow.

## Conventions

- 2-space indent, LF, ESM, TypeScript. ESLint via `@nuxt/eslint-config` flat config ([eslint.config.mjs](eslint.config.mjs)).
- Class-based runtime with abstract `BaseFroggerLogger`; transports/reporters implement small interfaces.
- Commits: Conventional Commits (drives `changelogen`). Releases are `chore(release): vX.Y.Z`.
- When you add runtime files, remember they must be wired in [src/module.ts](src/module.ts) (auto-imports, plugins, server handlers) to be exposed.
