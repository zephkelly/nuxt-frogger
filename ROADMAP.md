# Frogger Roadmap — "make it lighter, then more useful"

> Context: Frogger works, but in day-to-day use it *feels heavy and cumbersome* — it prints a lot of
> build-time/runtime logs, boots a lot of machinery by default, and demands boilerplate at every call
> site. The author has used it across many production projects and still reaches for hand-rolled
> "activity event systems" instead. This roadmap treats **weight and ergonomics as the product
> problem**. The fix is mostly *subtraction*. Bigger feature bets come last, on purpose.
>
> Each theme lists concrete files. Nothing here has been implemented yet — this is the plan to approve.

## Guiding principles
1. **Quiet by default.** The library should be invisible until you ask it to speak.
2. **Zero ceremony for the common case.** One import, one call, done — without giving up tracing for
   those who want it.
3. **Pay for what you use.** Heavy subsystems are opt-in or lazy, not on-by-default.
4. **No regressions to the core promise:** logs still land in one place across server/SSR/CSR, and
   trace correlation still works for those who want it.

---

## Theme A — Quiet by default  ★ highest impact, lowest risk  ✅ DONE

> Delivered. Internal diagnostics route through [src/runtime/shared/utils/internal-log.ts](src/runtime/shared/utils/internal-log.ts)
> (`froggerInternal.*`), gated by new `verbose` / `logLevel` module options (default `warn` in dev,
> `silent` in production). Build banners gated in [src/module.ts](src/module.ts): one "Ready to log" line in
> dev, none in production. The `ConsoleReporter` / `console-frogger` fallback stay on `console.*` on purpose —
> that's the user's own log output, not internal chatter.

The single biggest source of the "heavy" feeling. There are **~129 raw `console.*` calls** in `src/`
and several unconditional `🐸 FROGGER …` prints on every dev/build start.

**A1. Internal diagnostics channel.**
Add one tiny leveled internal logger (e.g. `src/runtime/shared/utils/internal-log.ts`) and route every
existing `console.*` through it, gated by a new `verbose` / `logLevel` module option. Default: silent
in production, warnings-and-up in dev.
- Hot spots to convert first: [_transports/websocket-transport.ts](src/runtime/logger/_transports/websocket-transport.ts) (~30),
  [websocket/state/index.ts](src/runtime/websocket/state/index.ts) (~14),
  [_reporters/console-reporter.ts](src/runtime/logger/_reporters/console-reporter.ts) (~12),
  [app/services/log-queue.ts](src/runtime/app/services/log-queue.ts) (~10),
  [server/services/server-log-queue.ts](src/runtime/server/services/server-log-queue.ts) (~8),
  [_transports/file-transport.ts](src/runtime/logger/_transports/file-transport.ts) (~8),
  [_transports/batch-transport.ts](src/runtime/logger/_transports/batch-transport.ts) (~8).
- Keep genuine error reporting (e.g. the catch in [base-frogger.ts](src/runtime/logger/base-frogger.ts#L301)), but make it routed + suppressible.

**A2. Silence the build-time banner.**
In [src/module.ts](src/module.ts), gate the `🐸` prints (L245, L253, L268, L299, L350, L365) behind the
verbose flag. At most **one** concise "Frogger ready" line in dev; **nothing** in production builds.
Keep hard errors (e.g. the both-modules-disabled throw at L159).

**Acceptance:** a default `npm run dev` start emits ≤1 Frogger line; a production build emits 0; a noisy
runtime path (e.g. websocket reconnect) emits 0 by default.

---

## Theme B — Less boilerplate  ★ ergonomics

Today every call site pays `const logger = useFrogger()` and every cross-boundary `$fetch` pays
`headers: logger.getHeaders()`. That's deliberate (one logger = one span) but it's the "cumbersome"
the author feels. Goal: make the *casual* path one line, keep the *explicit-span* path available.

**B1. Zero-ceremony logging entry.**  ✅ DONE (shipped as `frogger`)
Delivered as an auto-imported **`frogger`** object — a drop-in for `console.*` (variadic
`frogger.log/info/warn/error/debug(…)` + the full logger surface) on both client and server. Backed by an
*ambient* logger: one app-scoped `ClientFrogger` (client) / one per-request `ServerFroggerLogger`
(server, cached on `event.context`, resolved via `useEvent()`), so all `frogger.*` calls in a scope form
ONE span chain. `useFrogger()` / `getFrogger()` stay for when you explicitly want a fresh span.
Chosen instead of the `log` / `$frog` naming.
- Files: [src/runtime/app/frogger.ts](src/runtime/app/frogger.ts), [src/runtime/server/utils/frogger.ts](src/runtime/server/utils/frogger.ts),
  shared facade [src/runtime/logger/ambient.ts](src/runtime/logger/ambient.ts), arg reconciliation
  [src/runtime/shared/utils/normalize-log-args.ts](src/runtime/shared/utils/normalize-log-args.ts), wiring in [src/module.ts](src/module.ts).
- Signature reconciliation: trailing plain object → `ctx`, leading args joined into `msg`, `Error` lifted
  into `ctx.error`. console-only methods (`group`/`table`/`dir`/`assert`/`time`/`count`) are aliased or
  safe no-ops so a literal `console` → `frogger` swap never throws.

**B2. Auto-propagate trace headers (opt-out).**
A client `$fetch`/`useFetch` interceptor (Nuxt plugin) + a server equivalent that injects
`getHeaders()` automatically for same-origin requests, so users stop hand-threading it. Opt-out via a
config flag and a per-call escape hatch.
- Files: new plugin under [src/runtime/app/plugins/](src/runtime/app/plugins/); server hook alongside [trace-headers.server.ts](src/runtime/server/plugins/trace-headers.server.ts).

**Acceptance:** "log something + have it traced across a `$fetch`" is achievable with no logger variable
and no manual headers, while the explicit API still works unchanged.

---

## Theme C — Lighter defaults  ★ pay for what you use  ✅ DONE (C1 + C2)

> Delivered as a **breaking** re-tiering. All option defaults now live in
> [src/runtime/shared/utils/resolve-options.ts](src/runtime/shared/utils/resolve-options.ts)
> (`resolveFroggerOptions`), and the `defineNuxtModule` `defaults` block in [src/module.ts](src/module.ts)
> is intentionally empty so user-set options can be told apart from defaults. A bare install (preset
> `minimal`) now logs to **file + console only**; rate-limiter, scrubber, websocket, and
> global-error-capture are **opt-in**. `preset: 'full'` reproduces the old always-on behaviour.

**C1. Re-tier defaults.** ✅ Default = file + console only. rate-limiter, scrubber, websocket, and
global-error-capture are now **opt-in** (off unless `true`/object, or enabled via a preset). When off they
cost nothing at startup: no plugin, no experimental Nitro flag, no transport singleton, no `setInterval`.
- Done in: empty `defaults` + resolver-driven conditional wiring in [src/module.ts](src/module.ts);
  [resolve-options.ts](src/runtime/shared/utils/resolve-options.ts). Also fixed the scrub `|| true`
  force-on trap in [client/index.ts](src/runtime/logger/client/index.ts) and deleted the dead
  `global-error-register.ts` (would have resurrected always-on error capture).

**C2. Presets over a giant options object.** ✅ A `preset: 'minimal' | 'standard' | 'full'` shorthand
(`FROGGER_PRESETS`) that expands to subsystem toggles; individual options still override it.
- Done in: [module-options.ts](src/runtime/shared/types/module-options.ts) (`FroggerPreset` + `preset`),
  resolution in [resolve-options.ts](src/runtime/shared/utils/resolve-options.ts). Tests:
  [test/resolve-options.test.ts](test/resolve-options.test.ts) (32 cases).

**Acceptance (met):** `preset: 'minimal'` / bare install starts with no rate-limiter (runtime config emits
literal `rateLimit: false`), no websocket experimental flag/handler, no error-capture plugins, no scrubber
— and logs to file + console. Verified by the registered plugins/handlers and the resolver unit tests.

> Also removed the vestigial `public.globalErrorCapture` option (never read at runtime — the live config
> key is `errorCapture`). This is part of the breaking surface; documented in
> [docs/configuration.md](docs/configuration.md) under "Upgrading from a version before presets".

---

## Theme D — Code-weight cleanups  ★ reduce maintenance drag

**D1.** Merge [server/utils/auto.ts](src/runtime/server/utils/auto.ts) + [server/utils/manual.ts](src/runtime/server/utils/manual.ts)
into one parameterized util; pick a single public overload shape and document it. The module already
chooses which to auto-import based on `autoEventCapture` ([src/module.ts](src/module.ts#L312)).

**D2.** Type `useRuntimeConfig()` access (a typed `frogger` runtime-config interface) to retire the bulk
of the ~63 `@ts-ignore`/`@ts-expect-error` — densest in [src/module.ts](src/module.ts#L186), the
`getFrogger` utils, and [base-frogger.ts](src/runtime/logger/base-frogger.ts#L54).

**D3.** Remove the misleading `spanId: parentSpanId` line in
[server/index.ts](src/runtime/logger/server/index.ts#L103) (never read — `generateTraceContext` mints a
fresh span). Add a unit test asserting child trace lineage (shared `traceId`, child `parentId` ==
parent's last span) to lock the behavior.

**D4.** Backfill tests for the core logger classes, the file/batch/http transports, and one end-to-end
client→ingest→file flow ([test/](test/) currently skips these).

---

## Theme E — Future: the "read it back" story  (after A–D)

The deeper reason a hand-rolled activity system can still feel more useful: Frogger is **write-only in
production**. It captures and ships, but offers no way to *query, browse, or attribute* what it stored.
The author's own stated direction is an "all-in-one observability solution" ([docs/why-frogger.md](docs/why-frogger.md)).
Deliberately sequenced last, since the immediate pain is weight, not capability.

Candidate bets (each its own future RFC):
- **Retrieval API** over stored logs (time range, level, source, trace id, context field) — the file
  store is already JSON-lines; needs an index/query layer.
- **Production-capable viewer** — the WebSocket streaming path exists but is dev-only; promote a guarded
  read path + a minimal UI (Nuxt DevTools panel and/or an embeddable admin route).
- **Entity timelines** — attribute/query by user/session/entity to render the per-entity activity feeds
  developers keep rebuilding by hand.
- **Optional queryable sink** — first-class SQLite/Postgres (or Axiom/Logflare/OTLP) destination so logs
  land somewhere queryable without bespoke glue.

---

## Suggested sequencing
1. ~~**A** (quiet)~~ — ✅ DONE. Immediate relief, no API change, low risk.
2. ~~**C1** (opt-in subsystems)~~ — ✅ DONE. Compounds A's quiet and cuts startup weight.
3. **B1/B2** (ergonomics) — B1 (`frogger` ambient) ✅ DONE; **B2** (auto-propagate trace headers) remaining.
4. **D** (cleanups + tests) — partially advanced by C1/C2 (dropped several `@ts-ignore`/dead code, added
   resolver tests); the bulk of D2 (typed `useRuntimeConfig`) and D4 (transport/e2e tests) remain.
5. ~~**C2** (presets)~~ — ✅ DONE (shipped with C1). Then **E** (read-back) as the larger, separately-scoped effort.

**Next up:** B2 (auto trace-header propagation) and Theme D (type the runtime config to retire the
remaining `@ts-ignore`, plus backfill transport / end-to-end tests).
