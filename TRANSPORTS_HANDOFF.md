# Frogger — Configurable Transports & Direct Ingest Handoff

> **Audience:** an implementation agent (Opus) building this feature in the `nuxt-frogger` repo.
> **Goal:** let users declare a **list of log transport destinations in the module config**, so Frogger
> automatically fans logs out to those origins — **from the client log queue and/or from the server** —
> with an **optional per-transport API key sent as `x-api-key`**. Keep the existing "import your own
> `HttpTransport`" escape hatch. This is the Frogger half of the **nuxt-observe** integration
> (Frogger emits; nuxt-observe collects).
>
> All file/line references below are verified against the current tree (`nuxt-frogger@0.1.11`).

---

## 1. What we're building (the target UX)

A new `transports` array in module config. Each entry is a destination. Frogger constructs the
transport for you and wires it into the right pipeline(s):

```ts
// frogger.config.ts  (or the `frogger` key in nuxt.config.ts)
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
  app: { name: 'marketing-site', version: '1.4.0' },

  transports: [
    // Ship logs to a self-hosted nuxt-observe dashboard.
    {
      url: 'https://observe.example.com/api/observe/ingest',
      apiKey: process.env.OBSERVE_INGEST_KEY,   // → sent as `x-api-key: <key>` on every batch
      client: true,   // fan out directly from the browser log queue (needed for static apps)
      server: true,   // AND from the Nitro server queue (for apps that have a backend)
    },
    // A second destination, server-side only, no auth.
    {
      url: 'https://logs.internal/ingest',
      // client defaults false, server defaults true
    },
  ],
})
```

Result:
- **`server: true`** → an `HttpTransport` is constructed in the Nitro `ServerLogQueueService` and
  receives every ingested batch (alongside the file/websocket transports).
- **`client: true`** → the browser `LogQueueService` POSTs each batch **directly** to that URL too,
  independent of Frogger's own ingest endpoint. This is what unblocks **static frontends with no
  backend of their own**.
- **`apiKey`** → always attached as the **`x-api-key`** header (never a query param, never
  `authorization`), on both sides, for consistency.

The existing programmatic path stays: `import { HttpTransport }` (auto-imported server-side) and
register it yourself via `addGlobalTransport()` for anything the declarative config can't express.

---

## 2. Gap recap & resolution

| Gap | Current state (verified) | Resolution in this work |
| --- | --- | --- |
| **A — client can't auth / send headers** | [`log-queue.ts:270`](src/runtime/app/services/log-queue.ts#L270) & [`:331`](src/runtime/app/services/log-queue.ts#L331) call `$fetch(endpoint, { baseURL, method, body })` with **no `headers`**. `public` config has no header/key field ([module-options.ts:96](src/runtime/shared/types/module-options.ts#L96)). | Client fans out to each `client:true` transport with `x-api-key` + `headers`. |
| **B — `HttpTransport` drops its `headers`** | [`http-transport.ts:73`](src/runtime/logger/_transports/http-transport.ts#L73) stores `options.headers`, but `createRequestHeaders()` ([:140](src/runtime/logger/_transports/http-transport.ts#L140)) builds a fresh `Headers` and **never merges them** — advertised `authorization`/custom headers silently never send. | Merge `this.options.headers` into the request; add first-class `apiKey`→`x-api-key`. |
| **C — transports hardcoded** | [`server-log-queue.ts:38-83`](src/runtime/server/services/server-log-queue.ts#L38-L83) wires File+WS only; `addTransport()` exists ([:197](src/runtime/server/services/server-log-queue.ts#L197)) but no config hook. | Resolver emits a transport list; server queue constructs + registers them at init. |
| **D — no native `session`/`route`/`feature`/`user`** | Not emitted on `LoggerObject` by design. | **Intentional — leave in `ctx`.** Document the ctx-key contract only (§9). No code change. |
| **E — `trace.flags` dropped by adapters** | Frogger emits `trace.flags`; canonical schema omits it. | Document only; low priority (§9). |

---

## 3. Config API (authoritative)

### 3a. `HttpTransportConfig` — the declarative entry

Add to `src/runtime/shared/types/module-options.ts` (new file `transports.ts` under `shared/types/`
is cleaner; export from there and re-export):

```ts
export interface HttpTransportConfig {
  /**
   * Full ingest URL — the friendly shorthand. Equivalent to setting `baseUrl`
   * to its origin and `endpoint` to its path. If both `url` and `baseUrl`/`endpoint`
   * are given, `url` wins.
   */
  url?: string

  /** Split form (parity with `HttpTransportOptions`). */
  baseUrl?: string
  endpoint?: string

  /**
   * Optional API key. When set, Frogger sends it as the `x-api-key` header on
   * every batch POST to this destination. This is the ONLY auth header Frogger
   * emits for a transport — for consistency across the fleet.
   */
  apiKey?: string

  /** Extra headers merged onto each request (after `x-api-key`). */
  headers?: Record<string, string>

  /**
   * Fan out to this destination from the browser client log queue.
   * @default false
   * ⚠️ A client transport's `apiKey`/`headers` are shipped in the public bundle — see §8.
   */
  client?: boolean

  /**
   * Fan out to this destination from the Nitro server log queue.
   * @default true
   */
  server?: boolean

  /** Optional label for diagnostics / dedupe. Defaults to the resolved URL. */
  name?: string

  /** Standard HttpTransport tuning (fall back to HttpTransport defaults). */
  vendor?: string
  timeout?: number
  retryOnFailure?: boolean
  maxRetries?: number
  retryDelay?: number
}
```

### 3b. Wire it into `ModuleOptions`

```ts
// src/runtime/shared/types/module-options.ts
export interface ModuleOptions {
  // ...existing keys...

  /**
   * Extra log destinations. Each entry forwards every log batch to an HTTP
   * ingest URL — from the server queue (`server`, default on) and/or directly
   * from the browser (`client`, default off). Independent of `preset`.
   *
   * @default []
   */
  transports?: HttpTransportConfig[]
}
```

**Not preset-controlled.** Transports are a routing primitive like `batch`, not an opt-in subsystem.
Default `[]` (no extra destinations). Works under any preset.

---

## 4. Resolver changes

`resolveFroggerOptions` ([resolve-options.ts:241](src/runtime/shared/utils/resolve-options.ts#L241))
normalizes each entry and **splits into client vs server lists** so each side only ships what it needs.

Add to `ResolvedFroggerOptions`:

```ts
export interface ResolvedHttpTransport {
  name: string
  baseUrl: string
  endpoint: string
  apiKey?: string
  headers: Record<string, string>   // does NOT include x-api-key; that's applied at send time from apiKey
  vendor?: string
  timeout?: number
  retryOnFailure?: boolean
  maxRetries?: number
  retryDelay?: number
}

export interface ResolvedFroggerOptions {
  // ...existing...
  transports: {
    server: ResolvedHttpTransport[]   // → runtimeConfig.frogger.transports
    client: ResolvedHttpTransport[]   // → runtimeConfig.public.frogger.transports  (⚠️ exposed)
  }
}
```

Normalizer:

```ts
function normalizeTransport(t: HttpTransportConfig): ResolvedHttpTransport | null {
  // Resolve url → baseUrl + endpoint
  let baseUrl = t.baseUrl ?? ''
  let endpoint = t.endpoint ?? ''
  if (t.url) {
    const u = new URL(t.url)
    baseUrl = u.origin
    endpoint = u.pathname + u.search
  }
  if (!endpoint && !baseUrl) return null   // skip invalid, warn via froggerInternal
  return {
    name: t.name ?? (baseUrl + endpoint),
    baseUrl, endpoint,
    apiKey: t.apiKey || undefined,
    headers: { ...t.headers },
    vendor: t.vendor, timeout: t.timeout,
    retryOnFailure: t.retryOnFailure, maxRetries: t.maxRetries, retryDelay: t.retryDelay,
  }
}

// in resolveFroggerOptions(...):
const allTransports = (options.transports ?? []).map(normalizeTransport).filter(Boolean) as ResolvedHttpTransport[]
const transports = {
  server: (options.transports ?? []).filter(t => t.server !== false).map(normalizeTransport).filter(Boolean),
  client: (options.transports ?? []).filter(t => t.client === true).map(normalizeTransport).filter(Boolean),
}
```
*(Implementer: keep the split clean — one map, then partition by the original entry's `client`/`server`
flags. Above is illustrative.)*

**Note on `apiKey` placement:** keep `apiKey` as a discrete field on the resolved transport (do **not**
pre-bake it into `headers`) so send-site code applies `x-api-key` uniformly and diagnostics can redact
it. Never log the key value.

---

## 5. runtimeConfig split (module.ts)

In `moduleRuntimeConfig` ([module.ts:99-133](src/module.ts#L99-L133)):

```ts
public: {
  frogger: {
    // ...existing...
    transports: resolved.transports.client,   // ⚠️ apiKeys here are bundle-visible
  },
},
frogger: {
  // ...existing...
  transports: resolved.transports.server,     // server-only secret, stays out of the client bundle
},
```

Add a build-time warning (gated by `allowInternal('warn')`, like the existing endpoint warning at
[module.ts:156](src/module.ts#L156)) when any `client: true` transport carries an `apiKey`, reminding
the author it will be public (§8).

---

## 6. `HttpTransport` fixes (Gap B + apiKey)

File: [http-transport.ts](src/runtime/logger/_transports/http-transport.ts).

1. **Add `apiKey` to `HttpTransportOptions`** (after `headers`):
   ```ts
   export interface HttpTransportOptions {
     // ...
     headers?: Record<string, string>
     apiKey?: string   // sent as x-api-key
     // ...
   }
   ```
   Carry it into the `Required<...>` options in the constructor (default `''`).

2. **Fix `createRequestHeaders()`** ([:140-163](src/runtime/logger/_transports/http-transport.ts#L140-L163))
   to actually apply configured headers + the key. The configured `headers`/`x-api-key` should win
   over nothing critical but must not clobber the trace headers Frogger sets — apply user headers
   first, then Frogger's own:
   ```ts
   private createRequestHeaders(batch: LoggerObjectBatch): Record<string, string> {
     const firstLog = batch.logs[0]
     const traceContext = firstLog?.trace
     const w3cHeaders = generateW3CTraceHeaders({
       traceId: traceContext?.traceId,
       parentSpanId: traceContext?.spanId,
       vendorData: { frogger: this.transportId },
     })

     const headers = new Headers({
       ...this.options.headers,                       // ← was missing (Gap B)
       'x-frogger-reporter-id': this.transportId,
       'x-frogger-processed': 'true',
       traceparent: w3cHeaders.traceparent,
       ...(w3cHeaders.tracestate && { tracestate: w3cHeaders.tracestate }),
     })

     if (this.options.apiKey) headers.set('x-api-key', this.options.apiKey)   // ← Gap A (server side)
     if (this.options.appInfo) headers.set('x-frogger-source', this.options.appInfo.name)

     return Object.fromEntries(headers.entries())
   }
   ```

This alone fixes the advertised-but-broken `headers` option in
[docs/guides/transports.md](docs/guides/transports.md) and gives the server path auth.

---

## 7. Server wiring — construct config transports at init

File: [server-log-queue.ts](src/runtime/server/services/server-log-queue.ts), in `initialise()`
after the File/WS transports are built (~[:68-82](src/runtime/server/services/server-log-queue.ts#L68-L82)):

```ts
// config.frogger.transports is ResolvedHttpTransport[]
const configured = (config.frogger.transports ?? []) as ResolvedHttpTransport[]
for (const t of configured) {
  try {
    const transport = new HttpTransport({
      baseUrl: t.baseUrl,
      endpoint: t.endpoint,
      apiKey: t.apiKey,
      headers: t.headers,
      vendor: t.vendor,
      timeout: t.timeout,
      retryOnFailure: t.retryOnFailure,
      maxRetries: t.maxRetries,
      retryDelay: t.retryDelay,
      appInfo: /* from config.public.frogger.app via parseAppInfoConfig */,
    })
    // Register alongside file/ws: push into downstreamTransporters (batched)
    // or directTransporters (unbatched), mirroring the existing branches.
    if (batchingEnabled) this.downstreamTransporters.push(transport)
    else this.directTransporters.push(transport)
  } catch (err) {
    froggerInternal.error('ServerLogQueueService: failed to construct configured transport', err)
  }
}
```

> Register configured transports **before** `createBatchTransport(this.downstreamTransporters)` is
> called, so they're included in the batch fan-out. Keep the File transport first so local disk
> persistence never depends on a remote being up.

The existing `addTransport()`/`removeTransport()`/`clearTransporters()` API is unchanged and remains
the runtime/programmatic path.

---

## 8. Client wiring — fan out from the browser queue

File: [log-queue.ts](src/runtime/app/services/log-queue.ts).

**Design:** the client queue currently has ONE sink (the app's own `public.endpoint`). Add a set of
**secondary sinks** from `config.public.frogger.transports`. On each flush, after building the
(scrubbed) batch, POST it to the primary endpoint (existing behavior, existing retry/backoff) **and**
to each client transport — independently.

Key requirements:

1. **Read sinks in the constructor** (alongside [:73-88](src/runtime/app/services/log-queue.ts#L73-L88)):
   ```ts
   this.clientTransports = (config.public.frogger.transports ?? []) as ResolvedHttpTransport[]
   ```

2. **Fan out in `sendLogs()`** ([:261-274](src/runtime/app/services/log-queue.ts#L261-L274)) and
   `sendLogImmediately()` ([:325-335](src/runtime/app/services/log-queue.ts#L325-L335)). Send the same
   `batch` to each sink:
   ```ts
   const targets: Array<{ url: string; baseUrl?: string; headers: Record<string,string> }> = []

   // primary self-endpoint — subject to the existing serverModule/endpoint guard
   if (this.shouldSendToPrimary()) targets.push({ url: this.endpoint, baseUrl: this.baseUrl, headers: {} })

   // config client transports — ALWAYS eligible, independent of the primary guard
   for (const t of this.clientTransports) {
     targets.push({
       url: t.endpoint || t.baseUrl,
       baseUrl: t.baseUrl || undefined,
       headers: { ...t.headers, ...(t.apiKey ? { 'x-api-key': t.apiKey } : {}) },
     })
   }

   const results = await Promise.allSettled(targets.map(target =>
     $fetch(target.url, { baseURL: target.baseUrl, method: 'POST', headers: target.headers, body: batch })
   ))
   ```

3. **Decouple the primary-endpoint guard.** The current early-return at
   [:232](src/runtime/app/services/log-queue.ts#L232) (`!serverModuleEnabled && endpoint === DEFAULT &&
   !baseUrl` → drop) must gate **only the primary self-endpoint**, not the whole flush. A **static app
   with no backend** (`serverModule: false`, default endpoint) must still fan out to its `client`
   transports. Refactor that guard into a `shouldSendToPrimary()` predicate used only for the primary
   target; client transports are always attempted.

4. **Failure handling per sink.** The existing 429-aware `retryState` machinery
   ([:111-203](src/runtime/app/services/log-queue.ts#L111-L203)) is designed for the single primary
   endpoint (the app's own server, which runs Frogger's rate limiter). For secondary client
   transports:
   - Keep the primary endpoint's retry/backoff exactly as-is.
   - For each client transport, apply **independent, bounded retry** (respect `Retry-After`/`429`,
     exponential backoff, drop after `maxRetries` for that sink). Do **not** let one remote's 429 stall
     logging to the app's own server, and do **not** re-queue the whole batch because one secondary
     failed. Simplest implementation: a small per-sink retry counter keyed by `transport.name`,
     mirroring the pattern in `HttpTransport.handleSendFailure()`
     ([http-transport.ts:190](src/runtime/logger/_transports/http-transport.ts#L190)).
   - On a `4xx` (bad key/schema) from a secondary, **drop and stop retrying** that sink for the batch
     (prevents a retry loop) and `froggerInternal.warn` once.

5. **Scrubbing already applies** — the batch is scrubbed before send at
   [:257](src/runtime/app/services/log-queue.ts#L257); all sinks receive the same scrubbed payload.

> **Do not reuse `HttpTransport` on the client.** It pulls `h3`'s `H3Error` and server-only assumptions.
> Keep the client sender a thin `$fetch` loop as above.

---

## 9. Gaps D & E — documentation only (no code)

**Gap D (session / route / feature / user):** intentionally **not** promoted to first-class
`LoggerObject` fields — keeping them out avoids polluting the log object. They ride in `ctx`. Freeze
this **ctx-key contract** (nuxt-observe's ingest adapter reads exactly these keys):

| Canonical field | Frogger `ctx` key |
| --- | --- |
| `session` | `ctx.session` |
| `user` | `ctx.user` |
| `route` | `ctx.route` |
| `feature` | `ctx.feature` |

Document this in [docs/getting-started.md](docs/getting-started.md) (the "Adding Context" section) and
in the nuxt-observe integration doc so both sides implement against the same keys. Example:

```ts
logger.info('checkout viewed', { route: '/checkout', feature: 'checkout', session: sessionId })
```

**Gap E (`trace.flags`):** Frogger emits `trace.flags`; the canonical schema drops it. No Frogger
change — just note it in the integration contract so the adapter's authors know it's intentional
(pass through `ctx` if they later need it).

---

## 10. Custom / imported transports (escape hatch — keep working)

Already supported; document it as the imperative complement to declarative config. Config entries are
plain serializable objects (they pass through runtimeConfig), so **arbitrary transport classes/closures
can't** go in config — they're registered programmatically from a server plugin:

```ts
// server/plugins/my-transport.ts
import { HttpTransport, addGlobalTransport } from '#imports' // auto-imported server utils

export default defineNitroPlugin(() => {
  addGlobalTransport(new HttpTransport({
    endpoint: '/ingest',
    baseUrl: 'https://logs.example.com',
    apiKey: process.env.LOGS_KEY,      // → x-api-key (after the Gap B fix)
  }))
  // ...or any object implementing IFroggerTransport { name, log, logBatch, ... }
})
```

`addGlobalTransport()` and `createHttpTransport()` already exist in
[server/utils/transport.ts](src/runtime/server/utils/transport.ts) — verify they're auto-imported
(they should be via the server-utils dir wiring in `module.ts`) and add the `apiKey` field to the
`createHttpTransport(string)` overload docs.

---

## 11. Security notes (call out loudly in docs)

- **Client transports expose their `apiKey`.** Anything under `public.frogger.*` is compiled into the
  browser bundle and visible in DevTools network. A `client: true` transport's key is therefore **not a
  secret**. This is acceptable *only* for a **write-only, per-service, rate-limited ingest key** (which
  is exactly what nuxt-observe mints) — never a key that grants read or admin. State this in the docs
  and emit the build-time warning from §5.
- **Server transports keep their key server-side** (`runtimeConfig.frogger.transports`), never shipped
  to the client. Prefer `server: true` whenever the app has a backend.
- **Env overrides:** because these live in runtimeConfig, keys are overridable per environment via
  `NUXT_FROGGER_...` (server) / `NUXT_PUBLIC_FROGGER_...` (client) without rebuilding config. Recommend
  sourcing `apiKey` from `process.env` in `frogger.config.ts` (as in §1) rather than hardcoding.
- **CORS / preflight:** a client-direct POST to a different origin with `x-api-key` + JSON body triggers
  a preflight `OPTIONS`. The receiving ingest server (nuxt-observe) must answer CORS preflight and allow
  the `x-api-key` header. (nuxt-observe's ingest handler already plans `handleCors` + single-file OPTIONS
  matching — note it as a cross-repo requirement.)

---

## 12. File-by-file change list

| File | Change |
| --- | --- |
| `src/runtime/shared/types/transports.ts` *(new)* | `HttpTransportConfig` interface. |
| [src/runtime/shared/types/module-options.ts](src/runtime/shared/types/module-options.ts) | Add `transports?: HttpTransportConfig[]` to `ModuleOptions`; re-export the type. |
| [src/runtime/shared/utils/resolve-options.ts](src/runtime/shared/utils/resolve-options.ts) | `ResolvedHttpTransport` type; `normalizeTransport`; `transports: { server, client }` on `ResolvedFroggerOptions`; populate in `resolveFroggerOptions`. |
| [src/module.ts](src/module.ts#L99) | Emit `resolved.transports.client` → `public.frogger.transports` and `resolved.transports.server` → `frogger.transports`; build-time warning for keyed client transports. |
| [src/runtime/logger/_transports/http-transport.ts](src/runtime/logger/_transports/http-transport.ts) | Add `apiKey` option; **fix `createRequestHeaders()` to merge `headers` (Gap B)** and set `x-api-key`. |
| [src/runtime/server/services/server-log-queue.ts](src/runtime/server/services/server-log-queue.ts#L68) | Construct + register configured server transports at `initialise()` (before batch transport creation). |
| [src/runtime/app/services/log-queue.ts](src/runtime/app/services/log-queue.ts) | Read `public.frogger.transports`; fan out each batch to secondary sinks with `x-api-key`; split the primary-endpoint guard into `shouldSendToPrimary()`; per-sink bounded retry. |
| [src/runtime/server/utils/transport.ts](src/runtime/server/utils/transport.ts) | Docs/overload note for `apiKey` in `createHttpTransport`. |
| `docs/guides/transports.md`, `docs/getting-started.md`, `docs/configuration.md` | Document `transports` config, `x-api-key`, the ctx-key contract (§9), and the security notes (§11). |

---

## 13. Test plan (Vitest)

- **Resolver:** `transports: [{ url }]` → server list has one entry, client list empty (default
  `server:true, client:false`). `client:true` splits into both. `url` parses to `baseUrl`+`endpoint`.
  `apiKey` preserved discretely, never folded into `headers`. Invalid entry (no url/endpoint) dropped.
- **HttpTransport (Gap B):** `new HttpTransport({ headers: { 'x-test': '1' }, apiKey: 'k' })` →
  `createRequestHeaders()` output includes `x-test: 1` and `x-api-key: k`, and still includes
  `traceparent` + `x-frogger-processed`. Regression-lock the previously-dropped headers.
- **Server queue:** with a configured transport, `getReporterInfo()` (or a spy on `addTransport`/
  downstream list) shows the HttpTransport registered alongside the file transport; a batch reaches it.
- **Client queue:** mock `$fetch`; a `client:true` transport with `apiKey` produces a POST to its URL
  with header `x-api-key`. A `serverModule:false` + default-endpoint app still fans out to the client
  transport (primary guard doesn't suppress secondaries). A secondary `4xx` drops that sink without
  re-queuing the batch or blocking the primary.
- **Security:** server-only transport keys never appear in `runtimeConfig.public`.

---

## 14. Acceptance criteria

- [ ] `transports: [{ url, apiKey?, client?, server? }]` accepted in `frogger.config.ts` and the
      `nuxt.config` `frogger` key; typed via `HttpTransportConfig`; defaults `server:true, client:false`.
- [ ] `server:true` transports are constructed as `HttpTransport`s and receive every server-ingested
      batch (alongside file/websocket), registered before the batch transport is built.
- [ ] `client:true` transports receive every client batch **directly** from the browser queue, even
      when the app has no server (`serverModule:false`, default endpoint) — verified end-to-end.
- [ ] `apiKey` is sent as **`x-api-key`** on both client and server paths; no other auth header is used.
- [ ] **Gap B fixed:** `HttpTransport`'s configured `headers` are actually sent (regression test locks it).
- [ ] Server transport keys stay in `runtimeConfig.frogger`; client transport keys land in
      `runtimeConfig.public.frogger` and a build-time warning is emitted for keyed client transports.
- [ ] `addGlobalTransport()` / imported `HttpTransport` still work for custom instances.
- [ ] `session`/`route`/`feature`/`user` remain `ctx`-only; the ctx-key contract (§9) is documented.
- [ ] Docs updated (`transports.md`, `getting-started.md`, `configuration.md`); `pnpm test`,
      `pnpm test:types`, `pnpm lint`, and `nuxt-module-build build` all pass.

---

## 15. nuxt-observe integration contract (cross-repo summary)

What nuxt-observe can rely on from a Frogger source, once this ships:

- **Ingest auth:** Frogger sends the per-service key as **`x-api-key`** (header). nuxt-observe's ingest
  should accept `x-api-key` (and may keep `?key=` as a fallback, but Frogger will use the header).
- **Payload:** Frogger POSTs a `LoggerObjectBatch` = `{ logs: LoggerObject[], app?: { name, version }, meta? }`.
  `LoggerObject = { time, lvl, type, msg, ctx, tags?, env, source?, trace }`. The nuxt-observe frogger
  adapter maps `lvl→level`, `msg→message`, `ctx.error→error{}`, `trace→trace`, `app.name/source.name→
  source.app`, `env→source.env`.
- **Gap-D fields via ctx:** `ctx.session → session`, `ctx.user → user`, `ctx.route → route`,
  `ctx.feature → feature`. This is the frozen contract; keep it identical on both sides.
- **`trace.flags`** is present on Frogger's payload but intentionally dropped by the canonical schema.
- **CORS:** client-direct sources send a cross-origin JSON POST with `x-api-key` → the ingest route must
  handle `OPTIONS` preflight and allow the `x-api-key` header.
- **Status semantics Frogger already honors:** `4xx` → drop batch, no retry loop; `429` → back off and
  respect `Retry-After`; `5xx` → retry with backoff. Design nuxt-observe's ingest responses accordingly.
