# First-class observe support for frogger metrics + dashboard metrics views

Spans two repos: `nuxt-frogger` (producer, transport) and `../nuxt-observe` (ingest, storage, dashboard). Informed by two thorough code-mapping passes over both trees; file references verified against frogger v0.1.24 and nuxt-observe v0.0.8.

## Context: what exists and what is missing

**Frogger** ships a complete metrics pipeline (web vitals + device context, raw events, trace exemplars) but its only sinks are `file` and `memory`. `ResolvedMetricClientTransport = never` ([metric-transports.ts:65](src/runtime/metrics/shared/types/metric-transports.ts#L65)); there is no HTTP metric transport of any kind, so frogger currently cannot POST metrics anywhere.

**The log-side observe transport is not a class.** `observeTransport()` is a pure factory whose config `normalizeObserve()` ([resolve-options.ts:335-375](src/runtime/shared/utils/resolve-options.ts#L335-L375)) expands into one or two plain `ResolvedHttpTransport` entries with three forced decisions: path `/api/observe/ingest/frogger`, batch caps (500 events / 950 KiB, matching observe's 413 limits), and dual auth (server sends `x-api-key` header; client sends `?key=` query because observe resolves the CORS allowlist from the query string during preflight, and browser sends must stay header-free). Execution is the generic `HttpTransport` (server) and the client queue's fan-out. This is the pattern to replicate.

**Observe** has no metrics ingest, but was built log-only in data model and generalized in plumbing:
- Signal-agnostic and reusable as-is: API keys (`obsk_`, sha256-at-rest, query-first extraction), per-service CORS, per-service rate limit, loop guard (identical `meta.processChain` convention to frogger's `MetricObjectBatch.meta`), the app-name relay re-attribution guard, the migration registry, the SSE live bus with a `z.discriminatedUnion('type', ...)` wire union, scope/period/bucketing helpers, `chart-core.ts`, and the dashboard blocks registry whose source states `'metrics' joins later (PLAN-blocks P7)`.
- Log-only, needing parallel metric siblings: the `logs` table, `insertEvents`, purge, query filters, and the `/observe/metrics` page (currently 100% log-derived).
- OTel today: exactly one unused function, `otelSeverityToCanonical` (levels.ts:74-81). No OTLP code or deps in either repo; frogger's metric schema follows OTel conventions (base units, counter/gauge/histogram, W3C trace exemplars) by design.

**Hard prerequisite**: the P0 fixes in [REVIEW-METRICS.md](REVIEW-METRICS.md). An observe transport is pointless while the server queue drops the device/session envelope at the transport boundary (bug 1), exit beacons go to a malformed URL (bug 2), and buffered metrics are lost on shutdown (bug 6). Phase 0 below is that fix set.

## The wire contract (decided once, used by both repos)

- **Endpoint**: `POST /api/observe/ingest/frogger/metrics` on the observe deployment. Registered in observe's `module.ts` without a method filter (the established preflight rule).
- **Body**: `MetricObjectBatch` as frogger defines it: `{ metrics, app?, context?, session?, meta? }`. Observe's wire schema is permissive (`.passthrough()`, mirroring `adapters/frogger.ts`), so frogger schema evolution does not break older observe deployments.
- **Content type**: must accept `text/plain` string bodies via `readRawBody` + `JSON.parse`, exactly like frogger's own metrics ingest, because browser-direct exit batches arrive via `sendBeacon`. Observe's log route uses `readValidatedBody` and would silently mis-handle beacons.
- **Auth**: unchanged observe model. Server relay: `x-api-key` header. Browser-direct: `?key=` query, no custom headers (CORS preflight constraint, and `sendBeacon` cannot set headers at all, which makes query auth the only possible beacon auth).
- **Caps**: 500 events / 950 KiB per request client-side, 1 MiB + 500-event 413 guard server-side (constants mirrored the way `OBSERVE_MAX_BATCH_EVENTS` already is).
- **Responses**: 202 `{ ok, inserted }`; deterministic client errors stay 4xx (frogger drops on non-429 4xx, retries on 5xx; this split is load-bearing).
- **Attribution**: API key resolves the service; for relayed batches, per-event `source.app` re-attributes via `service_app_names` under the existing shared-group guard. This requires the `source` repurposing decision below.

### Decision needed: `MetricObject.source`

Today the collector stamps `source = { name: 'web-vitals', version: '5' }` (a hand-maintained literal the review already flagged as a staleness bug). Observe's relay attribution reads `source.app` semantics, and the log pipeline uses `log.source` for the origin app. Recommendation: reserve `MetricObject.source` for the origin app (stamped from `batch.app` at frogger ingest, matching the log idiom and REVIEW P0 fix 1), and drop the library literal (move it to `attr.collector` if provenance is ever wanted). Without this, relayed metrics attribute to the relaying service only.

## Part A: frogger

### Phase 0: land the REVIEW-METRICS.md P0 fixes

Envelope stamping in `enqueueBatch` (with the `source` decision above folded in), beacon URL join, route registration from the resolved endpoint, `frogger:init` laziness, shared rate-limiter call, shutdown drain. Roughly 50 lines plus test corrections; already fully specified in the review doc.

### Phase A1: `MetricsHttpTransport` (server) + `metricObserveTransport` factory

The Phase-2-planned HTTP metric transport, scoped to exactly what observe needs:

- `src/runtime/metrics/_transports/http-metrics-transport.ts`: mirror `HttpTransport`'s shape ([http-transport.ts](src/runtime/logger/_transports/http-transport.ts)): constructor reads `public.frogger.app` for identity, `metricBatch(metrics)` rebuilds `{ metrics, app, meta }` (meta stamped fresh: `{ processed: true, processChain: [transportId], source, time }`), chunks via the existing `splitMetricBatch` when caps are set, `$fetch` with header-or-query auth, drop on non-429 4xx, exponential backoff otherwise, `AbortController` timeout. Since Phase 0 stamps `context`/`session` onto each point at ingest, the bare-array `metricBatch` contract needs no widening and the envelope survives relay.
- `metricObserveTransport({ url, key, client?, server?, name?, timeout?, retry... })` in [metrics factories.ts](src/runtime/metrics/shared/transports/factories.ts): pure, `structuredClone`-safe, `{ type: 'observe', ...options }`, same option names as the log `observeTransport` (`url` + `key`).
- `normalizeMetricObserve` in [resolve-metrics.ts](src/runtime/metrics/shared/utils/resolve-metrics.ts): verbatim sibling of `normalizeObserve`: origin extraction with warn-and-drop on invalid URL, forced path `/api/observe/ingest/frogger/metrics`, forced caps, server entry with `apiKeyLocation: 'header'`, client entry with `apiKeyLocation: 'query'` + `publicKeyOk: true`.
- Types in [metric-transports.ts](src/runtime/metrics/shared/types/metric-transports.ts): add `MetricObserveTransportConfig` to the config union, add `ResolvedMetricHttpTransport` (field-compatible subset of the log `ResolvedHttpTransport`), and replace `ResolvedMetricClientTransport = never` with the HTTP type. This alias is the single largest type ripple (it reaches `ResolvedMetricsOptions` and the public runtimeConfig key).
- Wiring: construction branch in `buildConfiguredTransports` ([server-metrics-queue.ts:65-86](src/runtime/metrics/server/services/server-metrics-queue.ts#L65-L86)), which today silently produces nothing for unknown types (add the missing warn while there); extend the module.ts bundle-key warning loop (231-270) to inspect metric client transports; export the factory + types from `module.ts` and `runtime/options.ts` in lockstep, per the established three-file rule.

Result after A1: any frogger app's server relays its metrics to observe with one config line, `metrics: { transports: [metricObserveTransport({ url, key })] }`.

### Phase A2: client-direct fan-out (static sites, browser-to-observe)

The log queue already fans out client-side so `serverModule: false` apps still ship to observe; metrics deserve parity, and vitals are client-born anyway:

- Add `clientTransports` to `MetricsQueueService` (read from `public.frogger.metrics.transports`), with a `sendChunkToClientTransport` sibling of the log one ([log-queue.ts:382-430](src/runtime/app/services/log-queue.ts#L382-L430)): per-sink bounded retry, `Retry-After` honored, query auth, never touching primary queue state.
- Exit path: beacon each chunk to the observe URL with `?key=` appended (query auth is the only mechanism `sendBeacon` supports), falling back to `fetch(keepalive)`. Reuses the Phase 0-corrected URL join.
- Client transports must stamp `context`/`session` onto points (or carry the envelope) before sending, since browser-direct batches never pass through frogger's own ingest stamping. Cheapest: build the chunk from `buildBatch()` which already attaches the envelope, and let observe's adapter read envelope-or-point (it should anyway).

A2 is separable; server relay (A1) alone delivers value. Recommend shipping A1 first, A2 immediately after.

### Phase A3: docs + tests

- Unit: factory purity/clone test (mirror `transport-factories.test.ts:23-41`), `normalizeMetricObserve` (dual expansion, invalid URL drop, caps), resolver branch.
- Nuxt-env: server queue with a stubbed observe endpoint asserting body shape (envelope-stamped points, fresh meta), chunking at the caps, 4xx-drop vs 5xx-retry.
- Docs: extend `docs/guides/metrics.md` transport section (maintainer sign-off per repo rule before touching VitePress).

## Part B: nuxt-observe

Every step below follows a recipe observe's own AGENTS.md files already prescribe.

### Phase B1: schema + storage

- `shared/schema/metric.ts` + `metric-batch.ts`: canonical zod contract (zod-only imports, the hard `shared/schema` invariant), OTel-aligned fields: `name` (dot-namespaced), `kind` (`counter|gauge|histogram`), `value`, `unit` (base units), `labels`, `attr`, `env`, `trace` (validated against the existing `TRACE_ID_RE`/`SPAN_ID_RE`). `adapters/frogger-metrics.ts`: permissive `.passthrough()` wire schema. Re-export from `shared/schema/index.ts` so the contract rides the published `./schema` subpath.
- Migration `0012-metrics-tables`, `class: 'additive'`. Two tables (recommended):
  - `metric_batches`: id, service_id, received_at, app, version, session_id, sampled, ua, browser, os, device_type, effective_type, device_memory, hardware_concurrency, viewport_w, viewport_h. One row per ingested batch; this is the device-stats source of truth and honors frogger's context-once-per-batch cardinality guardrail at rest.
  - `metrics`: id (uuidv7), batch_id, time, received_at, service_id, name, kind, value, unit, env, rating, route, labels (JSON), attr (JSON), trace_id, span_id, session_id. `rating` and `route` get real columns because they are the two indexed labels the dashboard filters on.
  - Indexes: `(service_id, name, time)`, `(name, time)`, `(trace_id)`, `(session_id)`, batches `(service_id, received_at)`.
  - Alternative (flat single table with context columns denormalized per point) is simpler but repeats device fields 5-7x per page load and makes device aggregates scan the big table. Two-table is the recommendation; flag for maintainer confirmation.
- `server/utils/metrics.ts`: `metricToRow`, `insertMetricBatch` (one transaction inserting the batch row + points, then a single `publishLiveEvent({ type: 'metrics.ingested', ... })` per service, matching the documented one-emission-point convention), `purgeOldMetrics` + `purgeAllMetrics`.
- Retention: extend the `observe:purge` task to metrics + batches. `retentionDays` JSDoc already promises "Log/metric retention window", so config is done.
- The admin database console picks the new tables up automatically (it enumerates `sqlite_master`).

### Phase B2: ingest route

`server/api/observe/ingest/frogger/metrics.ts`, registered in `module.ts` without a method filter. Same 7-stage pipeline as the log route: per-service CORS from `?key=`, 405 guard, 413 size cap, key resolution + `checkIngestRateLimit`, validation, `checkIngestLoop(event, batch.meta)` (works verbatim; frogger uses the identical meta convention), insert, 202. Two deltas from the log route:
- `readRawBody` + `JSON.parse` before zod (beacon `text/plain` bodies), then `zFroggerMetricsBatch.parse`.
- Attribution: key-first, then generalize `createAppNameServiceResolver` to read the metric's `source.name` (the origin app after the frogger-side repurposing). The generalization is small: the helper only reads `event.source?.app` today; give it an accessor or a metric overload.

### Phase B3: query surface + live

- `shared/schema/metrics-query.ts`: `metricsQuerySchema` (period, service/group slugs, `name`, `rating`, `route` filters) + explicit response interfaces (`MetricsResponse`, `WebVitalSeries`, `DeviceBreakdown`). Explicit interfaces are a hard build constraint (inferred `AsyncData` types leak non-portable references and fail the module build).
- `server/utils/metrics-query.ts` reusing `periodToRange`, `DEFAULT_BUCKET_MS`, `MAX_BUCKETS`, `zeroFilledBuckets`:
  - Per-vital time-bucketed p50/p75/p95 over raw values (SQLite 3.25+ window functions, or in-process percentile over bucket-grouped rows; at web-vitals volume, bounded by MAX_BUCKETS, either is cheap. Recommend in-process for testability with the injectable-db pattern).
  - Rating distribution per vital (good/needs-improvement/poor counts, straight GROUP BY on the `rating` column).
  - Worst-routes table (p75 LCP/INP by `route`, capped like `TOP_SERVICES`).
  - Device/network breakdowns from `metric_batches` (browser, os, deviceType, effectiveType shares).
- Endpoints: `GET /api/observe/metrics/vitals`, `/metrics/routes`, `/metrics/devices` (or one endpoint with sections; split recommended so pages fetch only what they render), each `getValidatedQuery` + capability + `resolveEffectiveScope`, injectable `{ db }`.
- Capability: add `metrics.read` to `shared/rbac/capabilities.ts` (one file, additive), granted wherever `stats.read` is. Alternative is reusing `stats.read` with zero new surface; recommend the dedicated capability since the file is the single source of truth and metric data is a distinct sensitivity class (session ids, device fingerprint-adjacent fields).
- Live: add `zMetricsIngestedEvent` to the `zObserveLiveEvent` discriminated union (`shared/schema/live.ts`), a `metrics.ingested` branch in the live bus `publish()` reusing `serviceVisible()`, and entries in the client invalidation map so open metrics views refresh.

### Phase B4: dashboard views

- **Page**: keep `/observe/metrics` as the home. The current page is log-derived; split it into tabs: "Web Vitals" (new, default), "Devices" (new), and the existing log-derived content under its current heading. New page sections are components, so no `module.ts` change beyond what exists.
- **Components** (all `.client.vue`, d3 primitives on `chart-core.ts`, CSS-custom-property colors, `textContent`-only tooltips):
  - `ObserveVitalScoreCards`: current-period p75 per vital with rating coloring and thresholds (LCP 2.5s/4s, INP 200/500ms, CLS 0.1/0.25).
  - `ObserveWebVitalTrendChart`: bucketed p75 line with p50/p95 band, per selected vital.
  - `ObserveVitalRatingChart`: stacked good/needs-improvement/poor over time.
  - `ObserveRouteVitalsTable`: worst routes by p75, click-through filtered.
  - `ObserveDeviceBreakdown`: browser/os/device/connection share bars from batches.
  - Trace exemplar link: a metric row's `trace_id` links to the existing logs view filtered by trace (the `idx_logs_trace` index exists), with the documented dangling-reference caveat surfaced as an empty-state message.
- **Composable**: `useObserveMetrics` following the `useObserveStats` pattern exactly (shared period/scope state, computed query, explicit string `useFetch` key, explicit return interface); `useObserveLiveMetrics` wrapping it the way `useObserveLiveStats` does (clone, increment on `metrics.ingested`, reconcile on interval/reconnect, repaint throttled above the 320ms d3 transition).
- **Blocks**: new `ObserveBlockCategory: 'metrics'` + block types (vital score card, vital trend) in `observe-blocks.ts`, honoring the reserved slot from PLAN-blocks P7; additive, no layout schema change, gated on `metrics.read`.

### Phase B5: tests + docs

- Tier 1: schema parse/adapt tests (`test/schema/`), `metricToRow`/`insertMetricBatch`/percentile helpers against in-memory SQLite with injectable clock (`test/storage/`), a golden fixture `frogger-metrics-batch-<version>.json` mirroring the existing frogger log fixture.
- Tier 2: nuxt fixture test posting a real batch (including a `text/plain` body) end-to-end to a memory DB and reading it back via the query endpoint.
- Docs: `docs/guide/` metrics guide rewrite (it exists but is log-derived), `docs/guide/ingest.md` + `docs/reference/schema.md` extensions, sidebar entries. VitePress changes need maintainer sign-off first (both repos' rule).

## OTel alignment ("first class OTEL")

1. **Now (free)**: the canonical metric schema in B1 is field-mappable to OTLP by construction: `name`/`unit` follow OTel base-unit conventions (frogger already converts ms to seconds for this reason), `kind` maps to OTLP Gauge/Sum/Histogram, `labels`+`attr` map to attributes, `trace`/`span` are already W3C-valid and map to OTLP exemplars, `MetricContext` maps to resource attributes (`browser.*`, `os.*`, `device.*` semconv keys). Bake this mapping into the schema JSDoc so it is a contract, not an accident.
2. **Next (small, high leverage)**: an OTLP/HTTP JSON ingest route on observe, `POST /api/observe/ingest/otlp/v1/metrics`, translating `ExportMetricsServiceRequest` JSON into the same `insertMetricBatch` path (resource attrs to batch row, data points to metric rows). This makes observe a metrics backend for any OTel SDK, not only frogger, using the same key auth. JSON-only, no protobuf dependency; return `Partial Success` semantics per spec. Same pattern later for OTLP logs, where the currently-unused `otelSeverityToCanonical` finally gets its caller.
3. **Not planned**: OTLP *export* from frogger. When observe is the sink, frogger-to-observe uses the native contract; third parties exporting elsewhere would use an OTel SDK directly. Revisit only if a concrete need appears.

## Ordering and dependency graph

```
Phase 0 (frogger P0 fixes)
   -> A1 server transport  -> B2 ingest route -+
B1 schema/storage ---------^                   +-> B3 query/live -> B4 dashboard -> B5
   A2 client-direct (after A1 + B2 verified)   |
   OTLP ingest (any time after B1)             |
```

B1 and A1 can proceed in parallel once the wire contract section above is agreed. The first end-to-end milestone is A1+B1+B2: playground frogger app relaying vitals into observe's SQLite, visible in the admin DB console before any dashboard work exists.

## Verification

1. Frogger: `npm run dev:prepare && npm run test && npm run test:types`; observe: `pnpm test && pnpm test:nuxt && pnpm test:types`.
2. End-to-end: frogger playground with `metricObserveTransport` pointed at the observe playground; interact, background the tab; assert rows in `metrics`/`metric_batches` attributed to the right service, device context on the batch row, and a `metrics.ingested` SSE frame.
3. Beacon contract: POST a `text/plain` batch with `?key=` to the observe route from a third origin; assert CORS headers, 202, and rows landed.
4. Inertness both sides: frogger without the transport configured emits nothing new; observe without metrics traffic shows an empty-state metrics tab and zero schema errors on boot (additive migration).
5. Relay attribution: app A -> app B's frogger ingest -> observe; assert metrics attribute to app A's service when the services share a group, else to the key's service.

## Open decisions for the maintainer

1. **`MetricObject.source` repurposing** to origin-app (recommended; required for relay attribution and consistent with logs). Alternative: add a separate `origin` field and leave `source` as collector provenance.
2. **Storage shape**: two-table (recommended) vs flat denormalized.
3. **Capability**: new `metrics.read` (recommended) vs reusing `stats.read`.
4. **A2 scope**: ship client-direct fan-out in this effort or as an immediate follow-up.
5. **OTLP ingest**: include in this effort's tail or park as a stated next step.
