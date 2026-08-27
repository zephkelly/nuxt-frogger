# Adversarial review of the metrics subsystem (PLAN-METRICS.md + as-built code)

Multi-agent review pass: 5 Sonnet explorers over every code path the plan touches, 3 Opus adversarial reviewers (minimalism, runtime-risk, integration) plus an Opus minimal-design advisor, and Opus refuters that attempted to kill each top finding against source. 22 raw findings; the top 6 were adversarially verified and all 6 survived (0 refuted). Line references are against the current tree at commit 79cb500.

## Framing correction: the plan is retrospective

PLAN-METRICS.md reads as a forward-looking plan, but commit `1bcce7e` (ancestor of HEAD, clean tree) already implemented everything Phase 1 describes. This review is therefore a bug list and a delete-lines refactor list for shipped code, and several plan sentences are stale TODOs that would send a future implementer to make no-op or actively wrong edits (see "Plan text corrections").

## P0: confirmed bugs in the shipped code

### 1. Device stats never reach any sink (the batch envelope is dropped at the transport boundary)

Two reviewers found this independently; both verifications confirmed it. The client builds the `context`/`session`/`app` envelope correctly ([metrics-queue.ts:136-147](src/runtime/metrics/app/services/metrics-queue.ts#L136-L147)), the splitter carries it, the ingest route stamps `ua` onto it ([metrics.post.ts:89-92](src/runtime/metrics/server/api/metrics.post.ts#L89-L92)), and then [server-metrics-queue.ts:98](src/runtime/metrics/server/services/server-metrics-queue.ts#L98) reads only `batch.metrics` and fans out bare `MetricObject[]`. `MetricObject` has no field that could hold the envelope, so with `metrics: true` plus the file or memory transport, zero device/network/session fields land at rest. One of the two headline v1 capabilities writes nothing. The log pipeline explicitly solved this exact problem ([server-log-queue.ts:158-166](src/runtime/server/services/server-log-queue.ts#L158-L166), "the origin app only survives if the envelope's name is stamped onto each log first"); the metrics copy omitted that step, which also drops `batch.app`.

The tests cannot catch it: [server-metrics-queue.nuxt.test.ts:101](test/metrics/server-metrics-queue.nuxt.test.ts#L101) asserts `context.ua` on the enqueue spy (the input), then only asserts length on the sink.

Fix (verifier-corrected, ~10 lines, no transport-contract change):
- Add optional `context?: MetricContext` and `session?: { id: string; sampled: boolean }` to `MetricObject`.
- In `enqueueBatch` before fan-out, mirror the log idiom:
  ```ts
  const app = batch.app
  for (const m of metrics) {
      if (app?.name) m.source ??= { name: app.name, version: app.version ?? '' }
      m.context ??= batch.context
      m.session ??= batch.session
  }
  ```
  `??=` keeps it idempotent under a future relay hop; `batch.app` maps onto the existing `source` field, no new field needed.
- Change the round-trip tests to assert on the sink contents (`getCapturedMetrics(...)[0].context?.ua`), not the spy, for both the direct and batched transport paths.
- Reword the "once per batch, never per point" language (metric-batch.ts doc comment, PLAN-METRICS.md line 161): the envelope is collected and transmitted once per batch and denormalized onto each stored event at ingest; the cardinality guardrail is that it stays out of indexed `labels`, which this preserves.

### 2. Exit beacons go to a host literally named `api` on a default install

[metrics-queue.ts:241](src/runtime/metrics/app/services/metrics-queue.ts#L241) builds the beacon URL by naive concatenation: `(this.baseUrl || '') + this.endpoint`. In a default install `baseUrl` resolves to Nuxt's `app.baseURL` default `'/'` ([module.ts:145](src/module.ts#L145)), producing the protocol-relative URL `//api/_frogger/metrics`. Every exit beacon and its keepalive-fetch fallback is sent to host `api` and lost. The in-session path is unaffected (ofetch joins `baseURL` properly). The test suite masks it by stubbing `baseUrl: ''`, the one value that makes concatenation correct.

Fix (one line): `const url = this.baseUrl.replace(/\/$/, '') + this.endpoint`. Do not fix it at module.ts:145 (that key has three consumers that hand it to ofetch and are fine). Add a test that stubs `navigator.sendBeacon`, calls `flush(true)`, and asserts the first argument is exactly `/api/_frogger/metrics`.

### 3. Custom `metrics.public.endpoint` silently 404s every batch

[module.ts:423](src/module.ts#L423) registers the ingest handler at the hard-coded `DEFAULT_METRICS_ENDPOINT` constant while the client posts to the resolved `metrics.public.endpoint`. The option is typed, resolved, and documented, but any non-default value drops 100% of metrics with no diagnostic. (High severity; over the verify cap, not adversarially verified, but the advisor independently confirmed it.)

Fix (one line): `route: metrics.public.endpoint || DEFAULT_METRICS_ENDPOINT`, and skip registration when it is `false`. Then collapse the four copies of `'/api/_frogger/metrics'` (module-options.ts:197, resolve-metrics.ts:29, the inline fallback at metrics-queue.ts:66, playwright/index.ts:44) to one imported constant, the way `DEFAULT_LOGGING_ENDPOINT` already works.

### 4. Enabling metrics silently breaks the `frogger:init` extension point

[metrics.client.ts:92](src/runtime/metrics/app/plugins/metrics.client.ts#L92) calls `getAmbientClientLogger()` during plugin `setup()`. That force-constructs the ambient logger and fires the one-shot `frogger:init` hook before any user plugin has registered a handler (module plugins are unshifted ahead of scanned app plugins). `frogger:init` is the documented extension point for dynamic base context; today it fires lazily on the first `frogger.*` call, after user plugins. So turning on metrics disables a documented public hook.

Fix (verifier-corrected, ~4 lines): delete the eager call and resolve the page trace lazily, memoized inside the fallback branch of `resolveStamp()` (not at its top, since `getAmbientClientLogger()` returns the active span logger when one is open, and an unguarded memo would freeze a span's trace as the page trace). Route capture stays at init; it only reads `$router`. Add a regression test next to boot-context.nuxt.test.ts asserting that booting with metrics enabled does not fire `frogger:init` during setup.

### 5. The metrics ingest route has no rate limiting, and the plan's justification for that is wrong

[metrics.post.ts](src/runtime/metrics/server/api/metrics.post.ts) accepts a CORS-simple `text/plain` body with only a 413 guard: an unauthenticated, no-preflight, 1MB-per-request write into disk-backed sinks from any third-party page. The plan defers rate limiting to Phase 2 on the grounds that the limiter needs a keyed-instance refactor, but that is only true for a *separate* metrics budget. Sharing the existing budget is one line, and the limiter is already inert when the toggle is off ([rate-limiter/index.ts:33](src/runtime/rate-limiter/index.ts#L33), :286-288).

Fix (one line plus import): `await getFroggerRateLimiter().check(event)` after the 413 guard and before `readRawBody`, mirroring [logger.post.ts:102](src/runtime/server/api/logger.post.ts#L102). Trade-off to state explicitly in docs: the limiter is per-IP with shared blocking state, so a metrics burst counts against the same window as logs. Acceptable at web-vitals volume and the correct v1 trade.

### 6. Server-buffered metrics are lost on every graceful shutdown

[metrics-queue.server.ts:13-15](src/runtime/metrics/server/plugins/metrics-queue.server.ts#L13-L15) claims to mirror log-queue.server.ts but omits the one thing that plugin exists to do: the nitro `close` hook. There is also nothing to hook: `ServerMetricsQueueService` has no `drain()`, `MetricsBatchTransport` has no `drain()`, and `flush()` never force-flushes the downstream file buffer. With `maxAge` 15000 that is up to a 15s window of metrics dropped on every deploy and dev restart.

Fix: three-line close hook calling `flush()` covers most of it; exact log parity needs `drain()` ported (~24 lines), or it comes free with the `BatchWindow` extraction below.

## P1: beacon-contract gaps (medium)

- **Loop detection is a no-op on beacon traffic, and unreachable anyway.** `splitMetricBatch` strips `meta` on the documented assumption the send site restamps it; the beacon send site does not, and [metrics.post.ts:15](src/runtime/metrics/server/api/metrics.post.ts#L15) short-circuits without `meta`. Separately, the advisor showed `detectMetricsLoop` cannot fire at all in v1 (no metrics HTTP transport exists, `ResolvedMetricClientTransport = never`, the client stamps a single-element processChain). Lowest-code resolution: delete `detectMetricsLoop` (~30 lines) and reintroduce it in Phase 2 with `metricHttpTransport`, rather than fixing the meta stamping.
- **The 64KB beacon quota is cumulative, not per-call.** `BEACON_MAX_BYTES = 60KB` per chunk means chunks 2..n of a split flush are refused, and the keepalive fallback draws on the same exhausted budget. Lower the constant to ~16KB and note the quota is shared in-flight. (Largely moot if the splitter is cut, next section.)
- **In-flight in-session sends are lost on page hide.** `sendQueued` removes events from the queue before the `$fetch` resolves; the browser aborts the request on unload and `flush(true)` cannot rescue it. Fix: add `keepalive: true` to the in-session `$fetch` options (one property).

## Simplification program (the lowest-code mandate)

The advisor's verdict, confirmed by measurement: the "share zero body types and zero mutable state" constraint is fully satisfiable while sharing far more code. The three heaviest copied files each touch their body type in exactly one place (FileTransport only in `JSON.stringify`, BatchTransport only in `item.time` plus the downstream call, MemoryTransport only in the store element type). Roughly **750 lines are removable from the ~2,000-line as-built subsystem**, ranked by value:

| # | Change | LOC | Risk |
|---|--------|-----|------|
| 1 | Extract `JsonLinesFileWriter` (write/writeMany/flush/forceFlush over strings); both file transports hold one by composition. The writer never sees a body type. | ~-280 | Lowest |
| 2 | Extract `BatchWindow<T extends { time: number }>` (insertSorted, maxAge/maxSize scheduling, retry, drain) from BatchTransport; both batch transports become thin adapters. Also hands metrics the missing `drain()` for free. | ~-220 | The one item with churn risk to load-bearing log code; decline if churn budget is zero and hand-port `drain()` instead (+20) |
| 3 | Generic memory-store registry (`createStoreRegistry<T>(globalKey)`); public `getMemoryStore`/`getMetricsStore` signatures unchanged. | ~-120 | Low |
| 4 | One `createBatchCapture<TBatch, TItem>` behind both Playwright fixtures (the postDataJSON vs raw-string difference is illusory; the raw path serves both). | ~-70 | Zero (test-only) |
| 5 | Cut `splitMetricBatch` + its test for v1: with 5-7 vitals of a few hundred bytes against a 60KB budget, `chunks.length` can never exceed 1, and the keepalive fallback is the real oversize handler. Extract `chunkByCaps<T>` in Phase 2 when the HTTP transport needs it. | ~-140 | Low |
| 6 | Defer `detectMetricsLoop` to Phase 2 (unreachable in v1, see P1). | ~-30 | None |
| 7 | Shared `enforceMaxRequestSize(event, maxBytes)` + error-normalize wrapper for the two ingest routes (byte-for-byte copies today, including the same hard-coded 1MB literal). | ~-22 | None |
| 8 | Cut the dead client transport split: `ResolvedMetricClientTransport = never`, the always-empty `client` array, and the injected `public.frogger.metrics.transports` key that nothing reads. | ~-12 | None |
| 9 | Derive batch defaults instead of duplicating them (`DEFAULT_METRICS_BATCH = DEFAULT_BATCH`; `DEFAULT_METRICS_PUBLIC_BATCH = { ...DEFAULT_PUBLIC_BATCH, maxAge: 5000 }`), and delete the two inline `??` fallbacks in metrics-queue.ts (:66, :70) so the resolver is the single source of truth, matching LogQueueService. | ~-22 | None |
| 10 | Shared `beaconOrKeepalive(url, bodyString)` helper. Net zero lines for metrics, but the log pipeline's existing pagehide flush sends via plain `$fetch` with no keepalive ([log-queue.ts:311](src/runtime/app/services/log-queue.ts#L311)), so the log exit flush that exists today largely does not deliver. This is a pre-existing log-side data-loss bug the metrics work surfaced. | ~0 | Low |

Scope cuts for the maintainer to decide (defensible either way):
- **`maxEventsPerPage`**: dead guardrail in v1 (producer emits ~5-7 events vs a cap of 500) yet costs a public config key, resolver default, runtimeConfig field, queue state, and docs. Option: hardcode an internal constant, drop the public surface until Phase 2's `defineMetric` makes unbounded emission possible (~-35 lines).
- **`MetricObject.source` as shipped**: a hand-maintained `{ name: 'web-vitals', version: '5' }` literal stamped per event that will silently lie on the next web-vitals major. Note: fix P0 #1 repurposes `source` for the origin app (matching the log pipeline), which supersedes this either way; the collector's hardcoded version literal should go.

Explicitly keep as-built (the advisor examined and declined to share): the two queue service classes (genuinely divergent: scrubber/websocket/HttpTransport/relay stamping on one side, sampling/caps/beacon exit on the other), the resolver, the factories and 30-line base transport, the collectors, session.ts, the testing matchers, and the module wiring (which matches the websocket/errorCapture inertness precedent exactly).

Also endorsed as correct: the as-built `MetricsQueueService` deliberately does NOT follow plan line 106 ("copy the 429-aware limit-handler reuse"); doing so would add ~60 lines of unreachable header parsing. The shipped bespoke backoff is right; the plan text is the bug.

## Plan text corrections (PLAN-METRICS.md)

- Line 100 (and the mention at line 11): `normalizeToggle` is already exported ([resolve-options.ts:263](src/runtime/shared/utils/resolve-options.ts#L263)) and already imported by resolve-metrics.ts. Stale TODO; delete.
- Line 106: remove "429-aware limit-handler reuse" (see above).
- Lines 96/118/149: "no rate limiting in v1 because the limiter needs the keyed refactor" is false for the shared-budget case; only a separate `metrics.rateLimit` budget needs the Phase 2 refactor.
- Line 118: the claimed `meta.processChain` loop detection does not run on beacon traffic as built (and should be deferred entirely, see P1).
- Line 161 (verification step 4): unsatisfiable as written; reword per P0 #1.
- Verification step 5: the repo has no Playwright runner, config, or e2e specs at all; the fixtures are consumer-facing only. Either drop the step (the text/plain contract is covered by the nuxt-env test) or budget a `playwright.config.ts` + `test:e2e` script as explicit separate work.
- "Constraints honored" claims no em-dashes, but src/runtime/metrics contains 44 and docs/guides/metrics.md contains 11 (vs 21 in the entire pre-existing log runtime). Either run the cleanup pass or drop the claim.
- Naming note: the Playwright log fixture is `useFroggerCapture`, not `useFroggerLogCapture`.
