# nuxt-frogger — Integration Handoff

> **Audience:** an AI agent (Opus) integrating `nuxt-frogger` into a **new Nuxt 3 project**.
> **Goal:** stand up logging + tracing across server and client, then enable each opt-in feature
> deliberately. This document is self-contained — you should not need to read Frogger's source to
> complete a standard integration. Everything below is cross-checked against `nuxt-frogger@0.1.11`.

---

## 1. What Frogger is (and isn't)

`nuxt-frogger` is a **logging + W3C-tracing module for Nuxt 3** (requires `nuxt`/`@nuxt/kit` ^3.19).

The core idea: **log from anywhere — server (Nitro), SSR, or client (CSR) — and every log lands in
the same place.** Client logs are batched and "beamed" back to the server over HTTP, then written to
rotated JSON-lines files on disk (and optionally streamed to a dev WebSocket). Every logger instance
is also a **trace span**, so logs from one request/component are correlated, and trace context
propagates SSR→CSR and client→server using the [W3C Trace Context](https://www.w3.org/TR/trace-context/) standard.

**It IS for:** solo devs / small teams who want a zero-setup, self-hosted logger for a Nuxt app.
**It is NOT:** a distributed-microservice observability stack. There is **no production query API,
no search, and no viewer UI** — production storage is plain rotated JSON-lines files you read with
`tail`/`jq` or ship to an aggregator. The live WebSocket stream is **dev-only**.

---

## 2. Install & register (do this first)

```sh
# pick your package manager
pnpm dlx nuxi@latest module add nuxt-frogger      # automatic (edits nuxt.config for you)
# or manual:
pnpm add nuxt-frogger
```

Register in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-frogger'],
  frogger: {
    // Strongly recommended even for a minimal install — stamps source.{name,version} onto every log:
    app: { name: 'my-app', version: '1.0.0' },
  },
})
```

That's it. **A bare install works immediately** and gives you: file output (`logs/*.log`) + console
output + client→server batching. Everything heavier is opt-in (see §5).

> **Verify the install works before adding features.** Run the dev server, call `frogger.info('hello')`
> from a page and from a server route, and confirm a `logs/<today>.log` file appears with both lines.

---

## 3. The two ways to log

### 3a. Ambient `frogger` — the `console.*` drop-in (simplest)

Auto-imported everywhere (client components **and** server routes). No setup, no instance to manage.
Same method names as `console`, but **variadic with structure**:

- a trailing plain object becomes structured `ctx`
- remaining args are joined into `msg`
- an `Error` is lifted into `ctx.error` (name + message + **stack** preserved)

```vue
<script setup lang="ts">
frogger.info('component mounted')
frogger.error('checkout failed', err, { orderId })   // → msg:'checkout failed …', ctx:{ orderId, error:{…} }
frogger.log('cart total', total, { cartId })
</script>
```

```ts
// server/api/order.post.ts
export default defineEventHandler(async () => {
  frogger.info('order created', { orderId })
})
```

**Scope / span model:** `frogger` is backed by **one ambient logger** — one per app on the client,
**one per request on the server** (cached on `event.context.froggerAmbientLogger`, so server logs stay
correlated with the incoming client trace). All `frogger.*` calls in that scope form **one span chain**.
Per-request server scoping relies on `serverModule.autoEventCapture` (on by default).

### 3b. `useFrogger()` / `getFrogger()` — explicit instances (for real spans & scoped context)

Use these when you want an **independent trace span** or **scoped context** (e.g. per component, per
route, per util). Both return the identical `IFroggerLogger` contract.

```vue
<script setup lang="ts">
// client
const logger = useFrogger({ context: { feature: 'checkout' } })
logger.info('Hello, Client Frogger!')
</script>
```

```ts
// server — event auto-captured via Nitro asyncContext when autoEventCapture is on (default)
export default defineEventHandler(async (event) => {
  const logger = getFrogger()               // or getFrogger({ context }, event) to pass explicitly
  logger.info('Hello, Server Frogger!')
})
```

> **CRITICAL RULE — one logger = one trace span.** Do **NOT** create a single logger and share it
> across your whole app. Creating a logger is cheap; make a fresh one per component / route / util so
> spans stay meaningful. The ambient `frogger` is the deliberate exception (one shared span per scope).

---

## 4. Log anatomy — how to write good logs

Every log becomes a `LoggerObject`:

```ts
interface LoggerObject {
  time: number                                  // epoch ms
  lvl: number                                   // numeric level (see table)
  type: LogType                                 // 'error' | 'warn' | 'info' | ...
  msg: string                                   // STATIC human string — no dynamic data
  ctx: LogContext                               // Record<string, any> — put ALL dynamic data here
  tags?: string[]
  env: 'ssr' | 'csr' | 'client' | 'server'
  source?: { name: string; version: string }    // from `app` config
  trace: { traceId; spanId; parentId?; flags? }
}
```

**Signature is always `method(msg: string, ctx?: object)` — message first, context second.**

```ts
logger.info('user logged in', { userId: '123', sessionId })   // ✅ structured
logger.error('login failed for ' + email)                     // ❌ can't be scrubbed, not queryable
```

### Log levels (consola-based)

| `lvl` | `type`(s) | Methods |
| --- | --- | --- |
| `0` | `fatal`, `error` | `logger.fatal()`, `logger.error()` |
| `1` | `warn` | `logger.warn()` |
| `2` | `log` | `logger.log()` |
| `3` | `info`, `success`, `fail`, `ready`, `start` | `logger.info()`, `logger.success()`, … |
| `4` | `debug` | `logger.debug()` |
| `5` | `trace` | `logger.trace()` |
| `-999` | `silent` | `logger.silent()` |
| `999` | `verbose` | `logger.verbose()` |

Dynamic level (level known at runtime, accepts a plain string or a Vue `ref`):

```ts
logger.logLevel('error', 'this is an error at level 0', { code })
const level = ref<'info' | 'warn' | 'error'>('info')
logger.logLevel(level, 'status update')   // re-reads the ref each call
```

(Frogger does **not** support consola's `box` level.)

---

## 5. Configuration model — read this before enabling features

### Where config lives (precedence, highest wins)

1. **Runtime config / env vars** (e.g. `NUXT_PUBLIC_FROGGER_ENDPOINT`) — override everything.
2. **`frogger.config.ts`** at project root (via `defineFroggerOptions`) — overrides nuxt.config.
3. **`frogger` key in `nuxt.config.ts`**.
4. Defaults + preset expansion.

Either config location works; pick one style. A separate `frogger.config.ts` keeps Frogger config out
of `nuxt.config`:

```ts
// frogger.config.ts (project root)
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
  app: { name: 'my-app', version: '1.0.0' },
  // ...options
})
```

> ⚠️ **Config is captured at build/startup time.** Changing Frogger options at runtime does **not**
> work — the internals don't react. For dynamic behavior, configure per-**logger-instance** instead
> (see §6). In dev, editing `frogger.config.ts` triggers a hard restart.

### Frogger is QUIET by default — features are opt-in via presets

A bare install = **file + console + batching only.** The heavy subsystems are off until you turn them
on. A `preset` is shorthand for a group of toggles:

| Preset | scrub | rateLimit | errorCapture | websocket (dev live-stream) |
| --- | :---: | :---: | :---: | :---: |
| `minimal` *(default)* | ✗ | ✗ | ✗ | ✗ |
| `standard` | ✓ | ✓ | ✓ | ✗ |
| `full` | ✓ | ✓ | ✓ | ✓ |

**Recommended production baseline:** `preset: 'standard'` (redaction + ingest rate-limiting + global
error capture, no dev-only websocket).

Individual options **always beat the preset**, so start from a preset and flip one thing:

```ts
export default defineNuxtConfig({
  frogger: {
    preset: 'standard',
    scrub: false,       // turn one subsystem back off
    websocket: true,    // ...or add one the preset omits
  },
})
```

Each opt-in option accepts `true` (enable w/ sensible defaults), an **object** (enable + customize),
or `false`/omitted (off). `errorCapture` additionally accepts `{ client, server }` for per-side control.

> **Upgrading note:** versions before presets enabled scrub/rateLimit/websocket/errorCapture *by
> default*. If you're porting old config expecting those on, set `preset: 'full'` (or `'standard'`).

### Full `ModuleOptions` shape

```ts
interface ModuleOptions {
  preset?: 'minimal' | 'standard' | 'full'          // default 'minimal'

  clientModule?: boolean
  serverModule?: { autoEventCapture?: boolean } | boolean

  app?: { name: string; version?: string } | string

  file?: {                                           // always-on core (unless disabled)
    directory?: string          // default 'logs' (resolved at BUILD time)
    fileNameFormat?: string     // default 'YYYY-MM-DD.log'
    maxSize?: number            // default 10 MB — size rotation
    flushInterval?: number      // default 1000 ms
    bufferMaxSize?: number      // default 1 MB
    highWaterMark?: number      // default 64 KB
  }

  batch?: {                                          // server batching, always-on core
    maxSize?; maxAge?; retryOnFailure?; maxRetries?; retryDelay?; sortingWindowMs?
  } | false                                          // defaults: {200, 15000, true, 5, 10000, 3000}

  // ── opt-in subsystems ──
  rateLimit?: RateLimitingOptions | boolean          // §5c
  websocket?: WebsocketOptions | boolean             // §5b — DEV ONLY
  scrub?: ScrubberOptions | boolean                  // §5a
  errorCapture?: boolean | { client?; server? }      // §5d

  public?: {                                         // client-visible runtime config
    endpoint?: string           // default '/api/_frogger/logs' — the ingest route
    baseUrl?: string
    batch?: { maxSize?; maxAge?; ... } | false       // client batching; defaults {100, 3000, true, 3, 3000, 1000}
    serverModule?: boolean
  }
}
```

---

## 5a. Scrubbing / PII redaction (`scrub`)

Redacts sensitive fields **before logs are written to disk or broadcast**. Matches on **field names**
in `ctx` (case-insensitive, recurses into nested objects up to `maxDepth`). Enable with `scrub: true`.

**Built-in rules:** `password`/`token`/`secret`/`apikey` → `[REDACTED]`; `ssn`/`creditCard`/… → stable
hash; `email` → `j***@example.com`; `phone` → keep first/last digit; `name`/`address`/… → `J*****e`.

```ts
// frogger.config.ts
export default defineFroggerOptions({
  scrub: {
    maxDepth: 10,           // default 10
    deepScrub: true,        // recurse into nested objects — default true
    preserveTypes: true,    // keep original type when masking (number→0) — default true
    rules: [                // merged with (added to) the built-in defaults
      {
        action: 'redact_full',                       // see actions below
        fieldPatterns: ['authToken', /.*secret.*/i], // string or RegExp
        priority: 100,                               // highest priority wins on conflict
        description: 'Redact app-specific secrets',
      },
    ],
  },
})
```

**Actions:** `redact_full`, `mask_first`, `mask_partial`, `hash_value`, `mask_email`, `mask_phone`.

> ⚠️ The scrubber matches **field names**, not string contents. Prefer `logger.error('login failed',
> { email })` over `logger.error('login failed for ' + email)` — the latter can't be redacted.
> Console output may still show original values; the *stored* record is scrubbed.

Can also be set per-logger: `useFrogger({ scrub: { maxDepth: 3 } })`.

---

## 5b. Live logs / WebSocket (`websocket`) — DEV ONLY

Broadcasts every ingested log over a WebSocket so you can build a live console / debug overlay in dev.
**Registered only in development. There is no production log-reading path.** `useFroggerWebSocket()`
is auto-imported only when **both** `websocket` and `serverModule` are enabled.

Enable: `frogger: { websocket: true }` (or `preset: 'full'`).

```vue
<script setup lang="ts">
const socket = useFroggerWebSocket()
  .channel('main')                        // default channel
  .levels([0, 1, 2, 3])                   // or .levels(['error','warn'])
  .type(['error', 'fatal'])               // filter by log type
  .sources(['my-api'])                    // filter by source app name
  .tags(['checkout'])                     // filter by tags — all filters AND together
  .onConnected((ws) => console.log('connected'))
  .onMessage((ws, message) => {
    // frame: { type:'log', channel, timestamp, data, meta } — data is LoggerObject[]
    if (message.type === 'log' && Array.isArray(message.data)) {
      console.log('logs:', message.data)
    }
  })
  .onError((ws, event) => console.warn('socket error', event))
  .connect()

// reactive state + controls:
socket.status       // Ref<'connecting'|'open'|'closed'|'timeout'>
socket.lastMessage  // Ref<LogWebSocketMessage | null>
socket.ws           // Ref<WebSocket | undefined>
socket.send({ type: 'ping' })
socket.close()
</script>
```

To change filters at runtime: `close()` and build a fresh `useFroggerWebSocket()` with new filters,
then `connect()`. Config object form:

```ts
frogger: {
  websocket: {
    route: '/api/_frogger/dev-ws',   // default
    defaultChannel: 'main',
    upgrade: (request) => true,      // gate who may open the socket (return false to reject)
    maxConcurrentQueries: 10,
    maxQueryResults: 1000,
    defaultQueryTimeout: 30000,
  },
}
```

A ready-to-copy live console component lives at
[`playground/components/LogViewer.vue`](playground/components/LogViewer.vue) and a full worked page
(with checkbox filters) at [`playground/pages/live-logs.vue`](playground/pages/live-logs.vue).

---

## 5c. Rate limiting (`rateLimit`)

Guards the **server ingest endpoint** (`/api/_frogger/logs`) from log floods (runaway loops or abuse).
It limits how many *batches* the server accepts from a source — **not** how often you call
`logger.info()`. Enable: `frogger: { rateLimit: true }`.

Four sliding-window tiers; the **most restrictive** match wins:

| Tier | Limits | Default limit | Window |
| --- | --- | --- | --- |
| `perIp` | one IP | 100 | 60s |
| `perReporter` | one reporter/transport id | 50 | 60s |
| `perApp` | one app (`app.name`) | 30 | 60s |
| `global` | everyone combined | 10000 | 60s |

Over-limit → `429` + `Retry-After` + `x-rate-limit-*` headers. Persistent offenders get **escalating
blocks** then a temporary ban. **The client log queue is 429-aware** and backs off automatically — you
write no retry logic for normal client logging.

```ts
export default defineFroggerOptions({
  rateLimit: {
    limits:  { global: 10000, perIp: 100, perReporter: 50, perApp: 30 },
    windows: { global: 60, perIp: 60, perReporter: 60, perApp: 60 },   // seconds
    blocking: {
      enabled: true,
      violationsBeforeBlock: 3,
      timeouts: [60, 300, 1800],   // escalating block durations (s)
      finalBanHours: 12,
      escalationResetHours: 24,
    },
    storage: {                     // Nitro KV; default in-memory. Use a shared driver for multi-instance:
      driver: 'redis',
      options: { /* unstorage driver options */ },
    },
  },
})
```

> For multi-instance / clustered deployments, point `storage` at a shared driver (e.g. Redis) so
> counters are consistent across instances. Default in-memory KV is per-process.

---

## 5d. Automatic error capture (`errorCapture`)

Installs global error handlers so uncaught errors are logged automatically with context + stacks.
Enable: `frogger: { errorCapture: true }` or `{ client: true, server: false }`.

**Client** — hooks Vue's global `errorHandler` (render fns, lifecycle, watchers, event handlers). Each
logged at `error` level with `{ component, info, stack, uncaught: true }`.
⚠️ Vue's handler does **not** catch raw `window` errors or unawaited promise rejections outside Vue's
reactivity — log those explicitly with `frogger.error(...)`.

**Server (Nitro)** hooks:

| Source | Logged as |
| --- | --- |
| `nitroApp.hooks('error')` | `error` (route handler throws, w/ request context) |
| `uncaughtException` | `fatal` (process then exits) |
| `unhandledRejection` | `error` |
| `rejectionHandled` | `warn` (only if `includeRejectionHandled`) |
| process `warning` | `warn` (only if `includeWarnings`) |

```ts
errorCapture: {
  client: {
    includeComponent: true, includeComponentProps: true, includeComponentOuterHTML: true,
    includeInfo: true, includeStack: true,
  },
  server: {
    includeRequestContext: true, includeHeaders: true,
    includeRejectionHandled: false, includeWarnings: false, includeStack: true,
  },
}
```

> Even without `errorCapture`, passing an `Error` to any log lifts it into `ctx.error` with its stack:
> `logger.error('checkout failed', { error })` and `frogger.error('checkout failed', err)` both work.

---

## 6. Per-logger features (runtime-configurable, no rebuild needed)

`useFrogger()` / `getFrogger()` accept `FroggerOptions`:

```ts
interface FroggerOptions {
  context?: LogContext                 // initial context merged into every log this logger makes
  scrub?: ScrubberOptions | boolean    // override scrubbing for this logger only
  consoleOutput?: boolean              // mirror to console — default true
}
```

### Context

```ts
const logger = useFrogger({ context: { feature: 'checkout' } })
logger.addContext({ userId: '123' })   // merge (uses defu)
logger.setContext({ userId: '456' })   // replace entirely
logger.clearContext()                  // remove all
// context is appended to EVERY log this logger emits
```

### Child loggers

```ts
const parent = useFrogger({ context: { userId: '123' } })
const child  = parent.child({ context: { sessionId: 'abc' } })         // SNAPSHOTS parent context
const rchild = parent.reactiveChild({ context: { sessionId: 'abc' } }) // LIVE-inherits later parent changes
// child ctx: { userId:'123', sessionId:'abc' } — reactiveChild updates when parent.setContext() runs
```

### Reporters (fan out from a logger)

A reporter is anything with a `log(entry)` method; it receives every (already-scrubbed) `LoggerObject`:

```ts
interface IFroggerReporter { log: (entry: LoggerObject) => void | Promise<void> }

logger.addReporter({
  log(entry) { if (entry.lvl <= 1) myAlertService.notify(entry.msg, entry.ctx) },
})
// also: removeReporter(r) / getReporters() / clearReporters()
```

---

## 7. Distributed tracing (W3C Trace Context)

Every logger instance is a span. To continue a trace across an HTTP hop, attach the logger's headers:

```ts
const logger = useFrogger()                            // works the same server-side with getFrogger()
const res = await $fetch('/api/some-endpoint', {
  headers: logger.getHeaders(),                        // adds traceparent + tracestate
})
```

- `getHeaders()` emits `traceparent` (`{version}-{traceId}-{parentId}-{flags}`) and `tracestate`
  (`frogger=<data>`, each service prepends its own entry). Override the vendor token with
  `getHeaders('my-vendor')`.
- **Incoming** headers are parsed automatically by Frogger's server plugin into `event.context.frogger`.
  So the **last log on the client is the parent of the first log on the server**, and vice versa.
- `logger.reset()` clears context and starts a fresh trace.

Worked multi-hop example: [`playground/server/api/demo/trace-downstream.get.ts`](playground/server/api/demo/trace-downstream.get.ts)
and [`playground/pages/trace-context.vue`](playground/pages/trace-context.vue).

---

## 8. Forwarding logs elsewhere — `HttpTransport`

Auto-imported server-side (Nitro). POSTs log batches to an external collector or a second Frogger
server, with timeouts, retry/backoff, and trace headers.

```ts
const transport = new HttpTransport({
  endpoint: '/ingest',                   // REQUIRED
  baseUrl: 'https://logs.example.com',   // defaults to your app baseUrl
  vendor: 'my-app',
  headers: { authorization: `Bearer ${token}` },
  timeout: 30000,
  retryOnFailure: true, maxRetries: 3, retryDelay: 1000,
  appInfo: { name: 'my-api', version: '1.0.0' },
})
await transport.logBatch(logs)   // logs: LoggerObject[]
await transport.destroy()        // flush + clean up
// also: setEndpoint(), setAppInfo(name, version), log(entry) for a single record
```

To redirect *all* client-beamed logs to an external endpoint instead of the local file sink, set
`public.endpoint` (or `NUXT_PUBLIC_FROGGER_ENDPOINT`). ⚠️ If you override `public.endpoint`, the
client no longer hits `/api/_frogger/logs` — make sure a handler exists at the new path or client logs
404.

---

## 9. Reading logs in production

There is **no** built-in query API or viewer. Logs are JSON-lines files:

```
logs/2026-07-07.log      # one JSON object per line; date + size rotation
```

Read with `tail -f logs/*.log | jq`, or ship the directory to a log aggregator, or forward with
`HttpTransport` (§8). The `directory` path is **resolved at build time** — set `file.directory` if you
need a specific location. Ensure the runtime user can write there and that your deployment persists /
rotates the directory (or forwards off-box).

---

## 10. How it works under the hood (mental model)

**Client path:** `useFrogger()`/`frogger` → build `LoggerObject` → optional scrub → console reporter →
enqueue into the in-memory **client LogQueue** (batches, exponential-backoff retry, 429-aware) → POST a
batch to **`/api/_frogger/logs`**. (During SSR, logs send immediately rather than queueing.)

**Server ingest:** handler at `/api/_frogger/logs` → size check → rate-limit → loop detection (anti
feedback via `x-frogger-*` headers) → `ServerLogQueueService` (singleton) → scrub → `BatchTransport`
(timestamp-sorted buffering) → fan out to transports: `FileTransport` (rotation) + `WebSocketTransport`
(dev broadcast, state in Nitro KV).

**Server-direct:** `getFrogger()`/server `frogger` enqueue straight into `ServerLogQueueService`,
auto-capturing the current H3 event via Nitro `asyncContext` to read incoming trace headers.

**Nitro experimental flags the module enables:** `asyncContext` (for `getFrogger` event capture),
`tasks`, and `websocket` (only when WS is on).

---

## 11. Recommended integration checklist

1. **Install** the module; add `app: { name, version }`. Confirm a `logs/*.log` appears from both a
   page and a server route. (§2)
2. **Adopt `frogger.*`** for casual logging; use `useFrogger()`/`getFrogger()` where you want scoped
   context or a distinct span. Never share one instance app-wide. (§3)
3. Write **structured logs** — static `msg`, dynamic data in `ctx`. (§4)
4. Choose a **preset**: `standard` for production (scrub + rateLimit + errorCapture), add
   `websocket: true` in dev if you want a live console. (§5)
5. If you handle PII, **review the scrub rules** and add app-specific ones. (§5a)
6. **Propagate trace headers** on cross-service `$fetch` calls with `logger.getHeaders()`. (§7)
7. For multi-instance deploys, set `rateLimit.storage` to a shared driver (Redis). (§5c)
8. Decide your **production log strategy**: read files in place, ship the dir, or forward via
   `HttpTransport` / `public.endpoint`. (§8, §9)

---

## 12. Gotchas / edge cases to keep in mind

- **Config is build-time.** Runtime option changes do nothing; use per-logger `FroggerOptions` for
  dynamic behavior. Editing `frogger.config.ts` in dev triggers a full restart.
- **Ambient `frogger` server scoping** needs `serverModule.autoEventCapture` (default on). With it off,
  pass the event explicitly to `getFrogger(event)` / `getFrogger(options, event)`, and the ambient
  `frogger` falls back to a process-scoped logger outside a request.
- **WebSocket & live logs are dev-only** and require `websocket` + `serverModule` both enabled.
- **Scrubbing matches field names, not string contents** — keep secrets in `ctx`, out of `msg`.
- **`public.endpoint` override** must point at a real handler or client logs 404.
- **`file.directory` is resolved at build time** — verify write permissions and persistence in prod.
- Rate limiting guards the **ingest endpoint**, not your `logger.*()` call sites.

---

## 13. Reference map (this repo, if the agent needs to dig deeper)

| Topic | File |
| --- | --- |
| Full architecture notes | [`AGENTS.md`](AGENTS.md) |
| Module entry / option wiring | [`src/module.ts`](src/module.ts) |
| Logger contract (`IFroggerLogger`) | [`src/runtime/logger/types.ts`](src/runtime/logger/types.ts) |
| Options + defaults | [`src/runtime/shared/types/module-options.ts`](src/runtime/shared/types/module-options.ts), [`resolve-options.ts`](src/runtime/shared/utils/resolve-options.ts) |
| Ingest handler | [`src/runtime/server/api/logger.post.ts`](src/runtime/server/api/logger.post.ts) |
| Transports | [`src/runtime/logger/_transports/`](src/runtime/logger/_transports/) |
| Scrubber | [`src/runtime/scrubber/index.ts`](src/runtime/scrubber/index.ts) |
| Rate limiter | [`src/runtime/rate-limiter/index.ts`](src/runtime/rate-limiter/index.ts) |
| Docs (VitePress) | [`docs/`](docs/) — `getting-started.md`, `configuration.md`, `guides/`, `reference/` |
| Working examples of every feature | [`playground/pages/`](playground/pages/) + [`playground/server/api/demo/`](playground/server/api/demo/) |
