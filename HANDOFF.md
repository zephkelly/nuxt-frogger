# HANDOFF: nuxt-frogger architecture review (28 Aug 2026)

> Purpose: let a fresh session (human or AI) pick up the review and act on it without re-deriving anything.
> Reviewed: v0.1.25, then reconciled against v0.1.26 (commit 9af3a9e, "feat: metrics enhancements") which landed mid-run.
> Nothing in the repo was modified by the review. All line numbers reference HEAD at the time and will drift; re-verify before editing.
> Shareable page with the same content: https://claude.ai/code/artifact/e622da73-cba3-46cf-88f1-f7fc582320bd

## 0. How to use this document

- Sections 1 to 3 are the read-before-touching-anything context: goal, verdict, verified defects.
- Section 4 is the suggested order of work. Section 5 is every recommendation (R1 to R36) with problem, proposal, evidence and what the reviewers changed. Each card is meant to be liftable into a GitHub issue as-is.
- Section 6 lists what the v0.1.26 commit changed about the review and the defects found in that new code.
- Sections 7 to 10 are supporting material: pipeline re-map additions, competitor lessons, docs drift, dropped proposals.
- Section 11 is the method and its caveats.

Repo conventions that apply to any follow-up work (from CLAUDE.md): never commit or push; update README/AGENTS.md/docs after code changes, but ask before changing VitePress docs; update or add tests for every change; no em-dashes, no emojis in code, no obvious comments.

## 1. Product boundary (the constraint every item was judged against)

nuxt-frogger is an all-in-one logging, metrics, performance and observability COLLECTION package for Nuxt. It is explicitly NOT a representational library: no dashboards, no UI, no viewer. The sibling project nuxt-observe consumes frogger's wire format, which makes the wire format (LoggerObjectBatch / MetricObjectBatch) frogger's real external API. Target user: solo devs and small teams. Principles from ROADMAP.md: quiet by default, zero ceremony, pay for what you use. No recommendation below makes a bare install heavier or noisier, and none proposes a UI.

## 2. Executive summary

Frogger's foundations are better than its feature surface, and its documentation is worse than both. Three independent advisors and three adversarial reviewers converged on the same picture: the option resolver, the ambient/AsyncLocalStorage context model, the declarative transport config, the labels-vs-attr cardinality discipline and the failure-isolation habits are all above the bar for a solo-maintainer module. What sits on top of them is a set of shipped-but-unreachable features, defaults that promise safety they do not deliver, and a data model a separate reader project cannot index without per-app glue.

Five defects are ship-blocking and were verified line by line in this pass. `rotateLogFile` renames the log file out from under an open write stream and never resets `currentFileSize`, and the `isRotating` guard it checks is declared at file-transport.ts:34 and assigned nowhere in the repo, so after the first rotation every subsequent line silently lands in the renamed file (src/runtime/logger/_transports/file-transport.ts:34,94,208-218,251; duplicated in metrics). The ingest route throws 400 unconditionally inside its `isLoop || shouldWarn` branch (src/runtime/server/api/logger.post.ts:109-127) while HttpTransport always sets `x-frogger-processed: 'true'` (http-transport.ts:213), so every frogger-to-frogger relay batch is rejected and dropped as a 4xx. The client log queue's only exit path is a plain `$fetch` on `pagehide`, with no beacon and no keepalive, while the metrics queue right next to it does this correctly. `preset: 'standard'` documents "redaction on" and resolves to a scrubber with zero rules. That same preset ships `includeHeaders`, `includeComponentProps` and `includeComponentOuterHTML` on by default, and takes ownership of SIGTERM/SIGINT to call `process.exit()`.

Underneath those, the biggest structural gap is that a log row carries no environment, release, session, user or route, so ROADMAP E ("read it back") is not implementable against today's data. And `frogger.debug()` is a process-wide no-op with no option to enable it (base-frogger.ts:68).

The recommended sequence is: fix the docs (free), version the envelope, fix the five defects, then earn back the data model, then add the automatic collection that makes "all-in-one" true.

### Architecture verdict

What the architecture gets right. `resolveFroggerOptions` is the strongest piece of the codebase: it is the single owner of every default, paired with a deliberately empty `defineNuxtModule` defaults block so user-set values stay distinguishable from defaults, and `normalizeToggle` structuredClones defaults so repeated resolutions cannot alias shared constants. The active-context mechanism (AsyncLocalStorage on the server, a module variable on the client, identical export shape) is the same answer roarr and nestjs-pino independently reached, and it is what makes the ambient `frogger` facade honest rather than a global. Declarative transports are serializable, order-preserving and per-entry client/server targetable. Failure isolation is disciplined: per-transport construction try/catch, per-reporter catch, and `drain()` as a deliberate departure from `flush()` for shutdown. Quiet-by-default and opt-in subsystems genuinely landed. The metrics wire type's labels-vs-attr split, and the refusal to pre-aggregate at ingest, are choices an OTel contributor would sign off on.

The structural weaknesses. First, the library duplicated along the wrong axis. Metrics is a line-for-line retype of the log pipeline, not a second instantiation of one pipeline: batch-metrics-transport.ts (263 lines) mirrors batch-transport.ts (324), file-metrics-transport.ts (262) mirrors file-transport.ts (291) down to the identical `require('node:fs')` rotation body, metrics-queue.ts (492) mirrors log-queue.ts (494). Every retry, backoff and rotation fix must be written twice, and the rotation bug above proves the cost: it exists in both copies. Reviewers were unanimous that the fix is real but the sequencing in the advisors' P0/epic framing is wrong - unifying two untested transports that both contain a corrupting bug hoists the bug into one class with no safety net.

Second, there is no data model for a reader. A log row is `{time, lvl, type, msg, ctx, env, source, trace}`. It cannot answer which environment, which release, which instance, which session, which user, or which route, ever, unless the app author stuffed those into `ctx` by hand. Nothing in module.ts or resolve-options.ts reads NODE_ENV, `environment` or `release`. `MetricObject` already carries session/user/route; `LoggerObject` carries none of them. That asymmetry, not any missing feature, is why the sibling reader project cannot be built well.

Third, the trace model is a per-log hash chain, not a span tree. `generateTraceContext()` mints a fresh spanId and mutates `lastSpanId` on every single log call (base-frogger.ts:173-197), and `createChildTraceContext()` snapshots whatever it happens to be, so a span's parent edge depends on how many rows the parent logged first. No two logs ever share a spanId, so "the logs inside this span" is not expressible. The only artifact representing a span as a unit is an optional log row.

Fourth, the wire format is the real public API - nuxt-observe consumes it - and it is unversioned, undocumented and speakable only by a receiver that already knows frogger's schema. `HttpTransport` always emits `{logs, app, meta}`; the `vendor` option is set at http-transport.ts:81 and never read again.

The target shape. Keep the resolver, the ambient model and the declarative transports exactly as they are. Add: one typed runtime-config accessor to retire the 69 `@ts-ignore`s at their source; a versioned envelope carrying a resource block and a record id; correlation keys promoted to top-level, unscrubbed fields on log rows; a stable per-logger spanId with a real SpanObject as the third signal; one Nitro request hook that produces route/status/duration for free; and a published transport contract plus an OTLP body shape so the collection-only mandate does not imply collection-for-one-reader. Extract the shared batch/file/http sink core last, once the defects it would otherwise inherit are fixed and the transports finally have tests.

## 3. Verified defects (re-read at HEAD by the orchestrator)

| Id | Defect | Where |
| --- | --- | --- |
| R3 | Every frogger-to-frogger relay batch is rejected with a 400. The handler throws inside the `isLoop || shouldWarn` branch unconditionally, and HttpTransport always sets `x-frogger-processed: 'true'`. The only genuine self-loop branch keys on `x-frogger-reporter`, a header nothing sets. | src/runtime/server/api/logger.post.ts:28,109-127; src/runtime/logger/_transports/http-transport.ts:212-213 |
| R6 | File rotation renames the file out from under the open write stream and never resets `currentFileSize`; `isRotating` is declared at :34 and assigned nowhere. After the first rotation every line lands in the renamed file forever (the `existsSync` guard makes later rotates no-ops). Duplicated in the metrics file transport. Uses `require('node:fs')` in an ESM package. Neither transport has a test. | src/runtime/logger/_transports/file-transport.ts:34,94,208-218,251; src/runtime/metrics/_transports/file-metrics-transport.ts:35,83,187,221 |
| R7 | Client logs die on page exit: the only exit path is a plain `$fetch` on `pagehide`, no `sendBeacon`, no `keepalive`, no `visibilitychange`. The metrics queue does all three correctly. | src/runtime/app/plugins/log-queue.client.ts:37-39; src/runtime/app/services/log-queue.ts:311-319; compare src/runtime/metrics/app/services/metrics-queue.ts:381-490 |
| R4 | `frogger.debug()` and `trace()` are process-wide no-ops: `this.level = options.level ?? 3` with no module option. `lvl` for silent/verbose is copied from consola's +/-Infinity, which JSON-serialises to `null`; `verbose()` cannot fire at any finite level. | src/runtime/logger/base-frogger.ts:68; src/runtime/shared/types/log.ts:46-60 |
| R9 | `preset: 'standard'` is commented "redaction on" and resolves to a scrubber with zero rules; `RECOMMENDED_RULES` is never reached by any preset. | src/runtime/shared/utils/resolve-options.ts:64-72,103-106,472-482 |
| R5 | Presets standard/full install SIGTERM/SIGINT handlers that `process.exit(0)` after a 3s drain, and `process.exit(1)` on uncaughtException. Nitro's `close` hook already drains. | src/runtime/server/plugins/global-error.server.ts:44-57,145-154 |
| R8 | Error capture defaults ship request headers (cookie, authorization), component props and full outerHTML. `event.headers` is a `Headers` instance which `scrubValue` walks via `Object.entries` (returns `[]`), so it passes by reference unredacted. | src/runtime/shared/utils/resolve-options.ts:159-174; src/runtime/server/plugins/global-error.server.ts:118; src/runtime/scrubber/index.ts:134-201 |
| new | `span.duration` exemplars point at the parent span (see section 6). | src/runtime/shared/utils/span-events.ts:78-112 |

Other quick facts verified at HEAD: 69 `@ts-ignore`/`@ts-expect-error` under src/; `LoggerObject.tags` is set by no code path; `HttpTransport.vendor` is assigned and never read; `public.serverModule` has zero readers; `websocket/deduplicator` has zero src/ call sites.

## 4. Suggested order of work

Ordered by value to the goal per unit effort, respecting the dependency graph the reviewers mapped. Each step is shippable on its own.

1. **Free, first.** R1 docs truth pass. R2 version the envelope (`meta.schema`) and add a uuidv7 `id` to every record. R2 is a prerequisite for every shape change below.
2. **Contained defect fixes, no design change.** R3 relay 400 (split warn from reject; fix the header contract), R7 beacon exit path and R11 ingest hardening (one edit to the ingest handler, switch to `readRawBody`), R6 rotation rewrite, R9 seed `RECOMMENDED_RULES` in the standard/full presets, R13 honour the W3C sampled flag, R14 ungate the client-key warning, R16 delete the dead websocket query scaffold and coalesce instead of dropping, R17 one `getFrogger`, and the span.duration exemplar fix. Land R21's `module.ts` setup-test harness before anything adds branches to that file.
3. **One 0.2.0 with a migration page (R18).** R4 real `level` option plus finite severity table and derived `sev`, R5 give back host shutdown, R8 privacy-safe error-capture defaults plus Map/Set/Headers traversal in the scrubber, R12 `trustProxy` and unspoofable limiter keys. Add `compatibility: { nuxt: '^4.0.0' }` and a `nuxt` peerDependency.
4. **Type the config, then extend it.** R19 typed runtime-config accessor (retire the 69 ts-ignores), then R10 resource block (service.name/version, deployment.environment, service.release, service.instance.id), R15 bounded queues, drop counters and `getFroggerHealth()`, R20 exported transport contract, `minLevel` per transport, `stdoutTransport()`.
5. **Make the data indexable.** R26 stable per-logger spanId (epic, breaking), R24 session/user/route as top-level never-scrubbed fields on log rows plus `frogger.identify()`, R25 one normalised exception shape with mechanism and fingerprint, R27 a `SpanObject` carried in the existing batch envelope.
6. **Automatic collection.** R22 per-request timing/status from Nitro hooks (route pattern only), R23 `$fetch` trace propagation with a same-origin allow-list (ROADMAP B2), R30 runtime metrics from perf_hooks and web-vitals attribution, R29 kind lock and cardinality overflow bucket, R31 `frogger.event()`, R33 deterministic tail sampling.
7. **Interop and consolidation.** R28 OTLP logs body shape via a `shape` flag on httpTransport, R34 wire-format spec page and delete `tags`, R35 scrubber value patterns and an honest hash, R32 retry only the downstream that failed, R36 extract the shared batch/file/http cores last.

### Quick wins (accepted, small effort)

| Id | Title | Priority |
| --- | --- | --- |
| R1 | Docs truth pass: shipped features are invisible, documented ones do not exist | P0 |
| R2 | Version the wire envelope and give every record a stable id | P0 |
| R3 | The ingest route rejects every frogger-to-frogger relay batch with a 400 | P0 |
| R4 | A real log-level option, plus the corrupted severity table underneath it | P0 |
| R5 | Give the host application back its own shutdown | P0 |
| R9 | `preset: 'standard'` promises redaction and installs a scrubber with zero rules | P1 |
| R13 | Honour and propagate the W3C sampled flag instead of fabricating it | P1 |
| R14 | A client-visible apiKey should not be a warning nobody sees | P2 |
| R16 | Delete the dead websocket query scaffold; coalesce instead of dropping batches | P1 |
| R17 | Logger-core hygiene: one getFrogger, an encapsulated console reporter, an honest reset() | P1 |

### Dependency graph (dependsOn as recorded)

- R4 after R2
- R7 after R3
- R8 after R2
- R10 after R2
- R11 after R3, R7
- R18 after R2
- R20 after R4, R19
- R21 after R16
- R22 after R18
- R23 after R13
- R24 after R2, R10, R22
- R25 after R8, R2
- R26 after R2, R18
- R27 after R26
- R28 after R4, R10, R11
- R30 after R29
- R31 after R2
- R32 after R2, R21
- R33 after R13, R22, R26
- R34 after R2, R10, R11, R24, R26
- R35 after R8
- R36 after R6, R15, R19, R21

## 5. All recommendations

Priority: P0 ship-blocking, P1 next, P2 valuable, P3 later. Effort: small / medium / large / epic. "Breaking" means observable behaviour or wire shape changes and belongs in the R18 0.2.0 batch. "Merged from" lists the advisor ids that were folded in (ARCH = architecture lens, DX = product lens, REL = reliability/security lens, OBS = observability data model lens).

### Theme: Stop losing and leaking data

Six verified defects where frogger either silently discards logs it accepted or ships secrets it promised to redact. All are P0, all are contained, and none require a design change. This theme is the whole of the pre-0.2 correctness work.

#### R3. The ingest route rejects every frogger-to-frogger relay batch with a 400

**P0 · small · reliability**

**Problem.** Verified in this pass. src/runtime/server/api/logger.post.ts:109 enters its rejection block on `loopDetectionResult.isLoop || loopDetectionResult.shouldWarn`, and then throws the 400 at :123 unconditionally inside that block - the warn-only case is never treated as warn-only. `shouldWarn` is true whenever `warnings.length > 0` (:74), and `detectLoggingLoop` pushes a warning whenever `x-frogger-processed` is present (:33-35) or `batch.meta.processed` is set (:46), both of which HttpTransport sets on every outgoing batch (http-transport.ts:213 and addBatchMetadata). So any app whose httpTransport/observeTransport points at another nuxt-frogger ingest route has 100% of its batches rejected - and a 400 is exactly what the client queue (log-queue.ts:322-326) and HttpTransport (isDropError) treat as "drop, do not retry". Compounding it, the one branch that detects a genuine self-loop is unreachable: it is gated on `x-frogger-reporter === 'true'` (:28), a header no code in the repo ever sets (HttpTransport sets `x-frogger-reporter-id`, :212).

**Proposal.** Split warn from reject: warn (through the ungated internal channel, see R15) when `shouldWarn`, and throw only when `isLoop`. Then decide the header contract and make both ends agree - either have HttpTransport set `x-frogger-reporter: 'true'` alongside its id, or delete that branch and rely solely on `processChain` duplicate detection, which is the only guard that can currently fire. Fix the self-loop comparison at :40 to use the resolved `app.name` from runtime config rather than `process.env.NUXT_APP_NAME`, which is unset in a normal Nuxt deploy. Land the H3-level test from R21 in the same change.

**Evidence.** `src/runtime/server/api/logger.post.ts:28,33-35,40,46,74,109-127`; `src/runtime/logger/_transports/http-transport.ts:212-213`; `src/runtime/app/services/log-queue.ts:322-326`

**Inspired by.** original (found by two reviewers independently, missed by all three advisors)

**Reviewers.** Reported as a missing item by two of the three reviewers and confirmed by direct read of the handler here. Both flagged that REL-5's validator work rewrites this exact handler, so this must be fixed first or the new validation is written against a code path nothing can reach. One reviewer added the dead `x-frogger-reporter` branch as a second, separate finding.

#### R5. Give the host application back its own shutdown

**P0 · small · BREAKING · reliability** · merged from REL-9

**Problem.** The error-capture plugin - enabled by presets `standard` and `full` - registers `process.on('SIGTERM')` and `process.on('SIGINT')` handlers that log, `await drainBeforeExit(3000)`, then call `process.exit(0)` (global-error.server.ts:145-154), and forces `process.exit(1)` on `uncaughtException` (:54-56). On a rolling deploy the platform sends SIGTERM expecting the HTTP server to finish in-flight requests; frogger unconditionally exits ~3s later, truncating any longer request and any other shutdown handler the app registered. All of this is redundant with the correct path frogger already uses: `nitroApp.hooks.hook('close', () => queue.drain())` in log-queue.server.ts:17-18.

**Proposal.** Remove the SIGTERM/SIGINT handlers by default; rely on Nitro's `close` hook plus `process.on('beforeExit')`. Put the old behaviour behind an explicit `errorCapture.server.takeoverSignals: true` for users with no Nitro close path. For `uncaughtException`, keep the log and drain but do not call `process.exit` unless `errorCapture.server.exitOnUncaught: true`. Document the drain timeout and note that serverless/edge deployments should use their platform's `waitUntil` equivalent instead.

**Evidence.** `src/runtime/server/plugins/global-error.server.ts:44-57,145-154`; `src/runtime/server/plugins/log-queue.server.ts:17-18`; `src/runtime/shared/utils/resolve-options.ts:64-72`

**Inspired by.** @sentry/nuxt's waitUntil-based flush; pino's documented exit-flush contract

**Reviewers.** Accepted by all three; two raised it to P0 on blast radius (a logging library owning host shutdown, shipped by two of three presets). Breaking, but as one reviewer put it, the break is "frogger stops doing something it should never have done". Batch into R18's 0.2.0.

#### R6. File transport rotation silently corrupts itself

**P0 · medium · reliability** · merged from REL-8, ARCH-12 (minimum-viable half)

**Problem.** Verified line by line in this pass. `rotateLogFile` (file-transport.ts:208-218) does `fs.renameSync(filePath, rotatedFilePath)` but never closes or reopens `this.writeStream`, so after rotation every subsequent write goes to the *renamed* file through the still-open fd and the freshly-named current file stays empty. `currentFileSize` is only ever reset inside `openNewStream`, which rotate does not call, so the size condition stays permanently true - but because rotate guards on `existsSync(filePath)` (:210), which is false after the first rename, every later rotate is a silent no-op rather than a cascade. The `!this.isRotating` guard read at :94 and :251 is declared at :34 and **assigned nowhere in the repo** (grep-confirmed, same in metrics/_transports/file-metrics-transport.ts:35,83,221). The rename also uses `const fs = require('node:fs')` at :215 in a package declaring `"type": "module"`, duplicated at file-metrics-transport.ts:187. Nothing gates a `fileTransport()` entry behind a node-server Nitro preset, so edge/serverless deployments fail at first write with no build-time signal. File is the primary documented local-persistence path for the target user, and neither file transport has any test.

**Proposal.** Rewrite rotation as: flush pending buffer -> `await closeCurrentStream()` -> rename -> `await openNewStream(fileName)` -> `this.currentFileSize = 0`. Set and clear `isRotating` around it, or delete the flag and rely on the existing `writePromise` serialization, which is the real mutex. Replace `require('node:fs')` with the already-imported promises API. On a stream `error` with ENOSPC/EACCES/EROFS, mark the transport degraded, emit one ungated internal error (R15), and stop buffering rather than accumulating. Add a `nitro:build:before` check that errors - not warns - when a `fileTransport()` entry is configured against a non-node preset, naming the preset and pointing at httpTransport/stdoutTransport. Apply the same fixes to the metrics copy. Backfill tests: rotation by size, rotation by date change, disk-full simulation.

**Evidence.** `src/runtime/logger/_transports/file-transport.ts:34,94,208-218,251`; `src/runtime/metrics/_transports/file-metrics-transport.ts:35,83,187,221`; `package.json "type": "module"`; `no preset guard in src/runtime/shared/utils/resolve-options.ts or server-log-queue.ts`

**Inspired by.** pino/sonic-boom and logrotate copytruncate semantics

**Reviewers.** Two reviewers raised this to P0, calling it the most thoroughly confirmed bug in the set. All three corrected the symptom description: because of the existsSync guard there is no file storm - writes silently land in the first rotated file forever, which is worse. ARCH-12's unstorage rebuild was rejected by one reviewer and downgraded to its own "minimum viable alternative" by the other two (it collides head-on with this fix and would turn size+date rotation into key naming, losing the artifact users actually tail); that minimum - the ESM import fix plus the preset guard - is folded in here.

#### R7. Client logs are lost on page exit: no beacon, no keepalive

**P0 · medium · reliability** · after R3 · merged from REL-1

**Problem.** The only client exit path is `window.addEventListener('pagehide', () => getLogQueue().flush())` (log-queue.client.ts:37-39), and `flush()` reaches a plain `await $fetch(...)` (log-queue.ts:314-319) with no `keepalive` and no beacon. Browsers cancel in-flight non-keepalive fetches at unload, so any buffered batch dies when the user navigates away. There is also no `visibilitychange -> hidden` listener, the only reliable exit signal on mobile Safari and Chrome. The metrics pipeline sitting next to it already does this correctly: metrics.client.ts:157-166 registers both events, and metrics-queue.ts:440-490 has the split/beacon-budget/fetch-keepalive ladder. The log pipeline, which carries the errors users most want, does not.

**Proposal.** Port the metrics exit path onto LogQueueService. Add `exitFlush()` that (a) splits the batch with `splitLoggerBatch` under a ~16 KiB per-chunk cap, (b) tries `navigator.sendBeacon(url, blob)` per chunk, tracking cumulative bytes against the shared 64 KiB browser-wide quota, (c) falls back to `fetch(url, {method:'POST', body, keepalive:true})` when a beacon is refused or the transport needs headers (header-auth client transports cannot use a beacon at all). Register on `visibilitychange -> hidden` as primary and `pagehide` as secondary, guarded against double-send. Because a beacon body is `text/plain`, logger.post.ts must switch from `readBody` (:104) to the `readRawBody` + `JSON.parse` pattern metrics.post.ts:57-66 already uses - do that edit once, together with R11, so the ingest route is touched once.

**Evidence.** `src/runtime/app/plugins/log-queue.client.ts:34-40`; `src/runtime/app/services/log-queue.ts:255-319,485-493`; `src/runtime/metrics/app/services/metrics-queue.ts:381-490`; `src/runtime/metrics/app/plugins/metrics.client.ts:157-166`; `src/runtime/server/api/logger.post.ts:104 vs src/runtime/metrics/server/api/metrics.post.ts:53-72`

**Inspired by.** Datadog browser-rum and Sentry transport exit handling; frogger's own metrics queue

**Reviewers.** Accepted by all three; one noted this is porting working code, not designing it. Two independently flagged that the readRawBody change is shared with R11 and should be a single edit to the ingest handler, with R21's H3-level test landing at the same time. One reviewer added the specific refinement that the beacon size check must happen before the call, since the 64 KiB quota is shared page-wide with every other beacon, not just frogger's.

#### R8. errorCapture defaults ship cookies, auth headers, component props and full outerHTML

**P0 · medium · BREAKING · security-privacy** · after R2 · merged from REL-3, REL-14 (container-traversal half)

**Problem.** `DEFAULT_ERROR_CAPTURE_SERVER` sets `includeHeaders: true` and `DEFAULT_ERROR_CAPTURE_CLIENT` sets `includeComponentProps: true` and `includeComponentOuterHTML: true` (resolve-options.ts:159-174), and presets `standard` and `full` enable error capture. global-error.server.ts:118 assigns `headers: event.headers` verbatim - Cookie, Authorization, x-api-key. None of `cookie`, `authorization`, `set-cookie`, `x-api-key` appear in PASSWORD_FIELDS or any other list in scrubber/field-lists.ts:14-41, and `event.headers` is a `Headers` instance which the scrubber cannot see inside at all: scrubValue's else-branch reaches it via `Object.entries(value)` (scrubber/index.ts:134-201), which returns `[]` for Headers, Map and Set, so those values are emitted by reference, unredacted. On the client, `$props` (routinely PII and tokens) and `$el.outerHTML` (rendered PII, unbounded size) go into `ctx.component`; an outerHTML blob can also push a row past the 1 MiB ingest cap, whose 413 the client queue treats as "drop the whole queue".

**Proposal.** (1) Client first - flip `includeComponentProps` and `includeComponentOuterHTML` to `false` by default (opt-in), and when outerHTML is enabled truncate to a documented cap (4 KiB) with a `…[truncated]` marker. This is the immediate, real leak. (2) Server - convert headers to a plain object and apply a hard deny-list (`cookie`, `set-cookie`, `authorization`, `proxy-authorization`, `x-api-key`, `x-auth-token`) replaced with `'[redacted]'` before the row is built, regardless of scrub config; optionally accept `includeHeaders: string[]` as an allow-list. (3) Teach `scrubValue` to traverse `Map`, `Set` and `Headers` (converting to plain objects on the copy) and to leave other class instances alone explicitly rather than by accident - this must ship in the same change, since it is the mechanism behind the header leak. (4) Add cookie/authorization/bearer patterns to PASSWORD_FIELDS. Note in CHANGELOG as a privacy-affecting default change.

**Evidence.** `src/runtime/shared/utils/resolve-options.ts:159-174`; `src/runtime/server/plugins/global-error.server.ts:112-120`; `src/runtime/app/plugins/global-vue-errors.ts:30-56`; `src/runtime/scrubber/field-lists.ts:14-41`; `src/runtime/scrubber/index.ts:134-201`; `src/runtime/app/services/log-queue.ts:322-326`

**Inspired by.** Highlight.io per-field opt-in network recording; OpenReplay network.sanitizer

**Reviewers.** Called "the most serious item on the list" by one reviewer; all three accepted. Two independently observed that `event.headers` being a Headers instance cuts both ways - it is unredactable *and* probably serialises to `{}` today, so the client props/outerHTML pair is the leak to fix first. All three required REL-14's Map/Set/Headers traversal to ship in the same change rather than after it; the rest of REL-14 stayed at P2 (R35).

#### R9. `preset: 'standard'` promises redaction and installs a scrubber with zero rules

**P1 · small · security-privacy** · merged from REL-2

**Problem.** `FROGGER_PRESETS.standard` and `.full` set `scrub: true` and are commented as the "production-sensible safety net: redaction, ingest rate-limiting and error capture on" (resolve-options.ts:64-72, verified). But `resolveScrub` runs `normalizeToggle(true, DEFAULT_SCRUB)` and `DEFAULT_SCRUB` is `{deepScrub: true, preserveTypes: true}` with no `rules` array (resolve-options.ts:103-106, 475-482), so LogScrubber builds an empty rule map and every field passes through untouched. `RECOMMENDED_RULES` exists and is good, and is never reached by any preset. A developer who sets `preset: 'standard'`, reads that redaction is on, and logs `{user: {email, password}}` ships plaintext passwords believing they are redacted.

**Proposal.** Fix at the preset layer, not the resolver. Seed `rules: [...RECOMMENDED_RULES]` in the `standard` and `full` preset entries only - that is exactly what the preset's own comment already promises - and leave a bare `scrub: true` a deliberate no-op, since resolveScrub carries an explicit comment ("Enabling scrubbing never injects rules") documenting that as intent. Update that comment so it no longer reads as documenting a footgun. Promote the existing dev-only "N rules active" line (module.ts:321-327) into an ungated build warning when a scrubber resolves to zero rules, gated through module.ts:119's locally-computed `allowInternal()` rather than `froggerInternal.warn`, which is silent at build time. Update docs/guides/scrubbing.md and the preset table to state exactly which rules the preset implies.

**Evidence.** `src/runtime/shared/utils/resolve-options.ts:64-72 (verified verbatim)`; `src/runtime/shared/utils/resolve-options.ts:103-106,472-482`; `src/runtime/scrubber/recommended.ts:24-67`; `src/module.ts:119,240-276,321-327`

**Inspired by.** pino redact defaults

**Reviewers.** Two reviewers rejected the advisor's proposed fix (defaulting bare `scrub: true` to RECOMMENDED_RULES) because it collides with a deliberate, comment-documented invariant at resolve-options.ts:472-473, and redirected it to the preset layer. That version is also non-breaking, so `breaking` was flipped to false and priority lowered from P0 to P1 accordingly. The third reviewer accepted the original but agreed the docstring documents the foot-gun as intent and must be rewritten either way.

#### R11. Ingest accepts unbounded, unvalidated, self-attributed batches and stamps no receive time

**P1 · medium · security-privacy** · after R3, R7 · merged from REL-5, OBS-6

**Problem.** logger.post.ts:87-97 guards size with `if (contentLength && parseInt(contentLength) > maxRequestSize)`, so a chunked POST with no content-length skips the guard entirely and `readBody` buffers the whole body. After that there is no validation: `enqueueBatch(logBatch)` runs on whatever parsed, dereferencing `batch.logs` (TypeError -> 500 per request), trusting `batch.app.name` to stamp `log.source` on every row (any internet client can post logs that appear to come from your production app), trusting per-log `time` (which drives BatchTransport's sort and flush scheduling), and imposing no cap on `logs.length`. Separately the route stamps nothing on receipt, so a client with a skewed clock - common on VMs and phones after sleep - produces rows that sort into the wrong place forever, while metrics.post.ts already does enrich at ingest (it stamps User-Agent), making the two pipelines inconsistent.

**Proposal.** Replace `readBody` with `readRawBody` (the same edit R7 needs) plus an explicit byte counter that rejects at the cap regardless of `content-length`. Add a hand-rolled validator, no new dependency: `logs` is an array of at most `maxLogsPerBatch` (default 1000) objects, each with numeric `time`/`lvl`, string `msg` capped at 32 KiB, object `ctx`; otherwise 400 with a stable error code. Clamp `time` into `[now - 24h, now + 5m]`. Stamp `meta.receivedAt = Date.now()` on every batch and denormalise it onto rows as `obsTime`, mirroring OTel's Timestamp/ObservedTimestamp split, and document the reader contract: `time` is what the emitter claimed, `obsTime` is what the collector observed. Add a server-authoritative `received: {at, ip}` and document that `app`/`source` on an inbound batch is client-declared and must be treated as untrusted by any reader.

**Evidence.** `src/runtime/server/api/logger.post.ts:87-104,135-136`; `src/runtime/server/services/server-log-queue.ts:150-166`; `src/runtime/logger/_transports/batch-transport.ts:124-137`; `src/runtime/metrics/server/api/metrics.post.ts:53-81`

**Inspired by.** Sentry envelope validation; OTel Logs Data Model (ObservedTimestamp distinct from Timestamp)

**Reviewers.** All three accepted; two required R3's control-flow fix first, since the validator would otherwise be written against an unreachable path. OBS-6 was merged in here on a reviewer's note that both changes rewrite the same handler and the readRawBody edit is shared with R7. Two reviewers trimmed OBS-6's scope: ship `receivedAt` and `obsTime`, defer the `skewMs` heuristic and the reader-side skew threshold until a consumer needs them, since the observed-vs-reported split is the durable part and the skew estimate is a policy that will be argued about.

#### R12. Rate limiter is bypassable, poisonable, and per-instance

**P1 · medium · BREAKING · security-privacy** · merged from REL-4

**Problem.** Four compounding defects on the one publicly exposed trust boundary a bare install stands up. (a) `extractClientIP` calls `getRequestIP(event, {xForwardedFor: true})` then falls through `cf-connecting-ip`, `x-real-ip`, `x-client-ip`, `forwarded` with no trusted-proxy configuration (identifiers.ts:5-37): an attacker rotating `x-real-ip` gets a fresh bucket per request, and one spoofing a victim's IP can drive that IP into the escalating block list (`blocking.finalBanHours`, default 24h). (b) The `reporter` and `app` tiers key on `x-frogger-reporter-id` and `x-frogger-source` (identifiers.ts:46-56), both attacker-supplied, so each unique value mints a new unstorage key. (c) `checkSlidingWindow`/`recordRequest` store per-key arrays of up to 500 timestamps via non-atomic get-then-set (index.ts:330-410, kv-layer.ts:82-92), losing increments under concurrency and, with the default memory driver, giving every instance its own counters. (d) Each ingest request costs up to 8 KV round trips.

**Proposal.** Split by urgency. Now: add `rateLimit.trustProxy: false | number | string[]` defaulting to `false` (socket peer address only; ignore all forwarding headers unless a hop count or CIDR list is given), and drop the header-derived `reporter`/`app` tiers from the limit key unless the request is authenticated, or at minimum hash them and cap distinct keys per window with an overflow bucket. Also add a boot-time warning when rate limiting is enabled against a memory driver, and document plainly that limits are per-instance without a shared driver. Later: replace the timestamp-array sliding window with a fixed-window or two-bucket counter using a single increment.

**Evidence.** `src/runtime/rate-limiter/utils/identifiers.ts:5-56`; `src/runtime/rate-limiter/index.ts:70-77,118-160,330-410`; `src/runtime/rate-limiter/utils/kv-layer.ts:82-92`

**Inspired by.** Express `trust proxy` semantics; Sentry's per-category rate-limit protocol

**Reviewers.** Priority: one reviewer said P0, two said P1 - took the more conservative reading (P1) on their shared observation that the limiter is off in the default `minimal` preset, which caps today's blast radius. Effort lowered from large to medium by splitting: two reviewers separated the trustProxy + spoofable-key fix (the actual security work) from the atomic-counter rewrite. One reviewer rejected the counter rewrite outright as microservice ceremony for a one-instance target audience, preferring documented per-instance semantics plus the boot warning; that is reflected as the deferred half.

#### R14. A client-visible apiKey should not be a warning nobody sees

**P2 · small · security-privacy** · merged from REL-15

**Problem.** Any `transports` entry with `client: true` has its resolved `apiKey` and `headers` written verbatim into `public.frogger.transports` (module.ts:155) and compiled into the browser bundle. The only guard is a build-time `console.warn` per keyed transport (module.ts:256-277), gated behind module.ts:119's `allowInternal('warn')` - which respects the user's setting but resolves to silent at the production default, exactly when the bundle actually ships. Copying a working server transport and flipping `client: true` therefore leaks a real ingest key to every visitor with no output at all in a production build. `publicKeyOk` already exists as the deliberate escape hatch for observe's write-only browser keys (resolve-options.ts:371).

**Proposal.** Ship the non-breaking half now: make that warning ungated so it prints in production builds too, and make its text name the transport and point at both `publicKeyOk` and moving the transport server-side. Hold the hard build error for the next major, where a resolved client transport carrying an `apiKey` without `publicKeyOk: true` fails the build. Same treatment for `metrics.transports.client`. Document `publicKeyOk` in docs/guides/transports.md as "I have verified this key is write-only, per-service and rate-limited".

**Evidence.** `src/module.ts:119,150-158,256-277`; `src/runtime/shared/utils/resolve-options.ts:371`; `src/runtime/shared/types/transports.ts`

**Inspired by.** original

**Reviewers.** Priority split P1/P2/P2 - took P2. Two reviewers rejected inverting to a build error now: it is a breaking change to catch a mistake that already has a documented escape hatch, so they split it into an ungated warning now and the error at the next major. One reviewer corrected the problem statement: the warning is gated by module.ts's own correctly-computed `allowInternal`, not by the misgated resolve-options path in R15 - it is silent in production only because the resolved default is silent there.

### Theme: Make the shipped surface honest

Features that exist but are invisible, options that are documented but dead, and one headline defect (frogger.debug() cannot be enabled). Cheapest value on the list: the docs pass is zero-risk and the biggest single adoption lever the project has.

#### R1. Docs truth pass: shipped features are invisible, documented ones do not exist

**P0 · small · docs**

**Problem.** Discoverability, not capability, is the binding constraint on adoption. docs/guides/metrics.md:13-15 states "There is no userland metrics API in this release" while `froggerMetrics.counter/gauge/histogram/timer/time` is implemented and auto-imported on both runtimes (src/module.ts:379-388, 445-451). docs/guides/transports.md:8-34 opens with "File transport (the default)" and a top-level `file: {}` key that resolve-options.ts:522-526 detects as removed legacy config and warns about. docs/configuration.md:34,93 still declares `file?: FileOptions`, types `transports` as an untagged array contradicting the transports guide, types `public.endpoint` as `string` when `false` is load-bearing, and omits `verbose`, `logLevel`, `spans`, `context` and `metrics` entirely. docs/getting-started.md:494 tells users `modules: ['frogger']`.

**After v0.1.26.** AGENTS.md metrics section was rewritten and is accurate; nothing under docs/ changed. docs/guides/metrics.md still denies the userland API v0.1.26 ships and names planned APIs (defineMetric / useFroggerMetrics) that are not the shipped froggerMetrics.

**Proposal.** One pass, no new code. (1) Rewrite docs/guides/metrics.md around the shipped `froggerMetrics` surface using the JSDoc examples already in src/runtime/metrics/shared/api/types.ts. (2) Delete the file-is-default opening of docs/guides/transports.md. (3) Generate docs/configuration.md's interface block from src/runtime/shared/types/module-options.ts rather than hand-maintaining a second copy - generation is what stops the drift; a CI diff check only reports it. (4) Fix `modules: ['frogger']` -> `'nuxt-frogger'`. (5) Document `apiKeyLocation`, `maxBatchEvents`/`maxBodyBytes`, `public.endpoint: false` and the `frogger:init` hook, none of which appear in any guide. (6) Correct AGENTS.md's Nuxt 3 line and its auto/manual description, and add the metrics facade and span-metric sink to its metrics section.

**Evidence.** `docs/guides/metrics.md:13-15 vs src/module.ts:379-388,445-451`; `docs/guides/transports.md:8-34 vs src/runtime/shared/utils/resolve-options.ts:522-526`; `docs/configuration.md:34,62-65,93-100,209`; `docs/getting-started.md:494`; `src/runtime/shared/types/module-options.ts:42-195`

**Inspired by.** original

**Reviewers.** All three reviewers accepted; two independently verified every drift claim. Two reviewers replaced the proposed CI diff-check with generating the interface block from ModuleOptions, on the grounds that a check reports drift while generation prevents it. Reviewer 1 added the AGENTS.md corrections, noting that a wrong entry there reliably becomes a wrong recommendation later - it did so four times in this batch.

#### R4. A real log-level option, plus the corrupted severity table underneath it

**P0 · small · BREAKING · api-ergonomics** · after R2 · merged from DX-3, ARCH-6, OBS-1

**Problem.** Two coupled defects. (a) `BaseFroggerLogger` hardcodes `this.level = options.level ?? 3` (base-frogger.ts:68) into `createConsola({level})`, `ModuleOptions` has no `level` key (module-options.ts:42-195), and `FroggerOptions.level` (options.ts:6) is an undocumented raw number - so `frogger.debug()` and `frogger.trace()` are silent no-ops app-wide with no documented way to enable them, while docs/reference/log-levels.md presents both as usable. There is also no volume control in the other direction. (b) `createLoggerObject` copies `lvl: logObj.level` straight off consola's LogObject (client/index.ts:136, server/index.ts:68). Verified against node_modules/consola/dist/core.mjs:2,15: consola assigns `silent: Number.NEGATIVE_INFINITY` and `verbose: Number.POSITIVE_INFINITY`, both of which `JSON.stringify` to `null`. Frogger's own LEVEL_TO_NUMBER claims -999/999 (log.ts:46-60), matching neither consola nor the wire. Because consola's gate is `(defaults.level || 0) > this.level` and verbose's level is +Infinity, `verbose()` cannot fire at any finite configured level at all.

**Proposal.** (a) Add `level?: LogType | { client?: LogType, server?: LogType }` to ModuleOptions, resolved in resolve-options.ts and threaded into the constructor default in place of the bare `?? 3`, with per-logger `FroggerOptions.level` still overriding. Accept level *names*, not numbers. Keep the shipped default at `'info'`. (b) Stop deriving `lvl` from consola: `lvl: LEVEL_TO_NUMBER[logObj.type] ?? LEVEL_TO_NUMBER.log`, and correct the table to finite, JSON-safe values. Add a derived `sev: number` carrying the OTel SeverityNumber (trace=1, debug=5, info=9, warn=13, error=17, fatal=21) computed from `type`, giving readers and any OTLP shaper a standard axis without renaming user-facing fields. Delete src/runtime/shared/utils/log-level-filter.ts (verified zero references). Decide the disposition of `verbose()` explicitly - give it a finite level in the new table or remove it - before encoding a number for it. Add a regression test asserting `JSON.parse(JSON.stringify(row)).lvl` is finite for all thirteen level methods.

**Evidence.** `src/runtime/logger/base-frogger.ts:68`; `src/runtime/shared/types/module-options.ts:42-195`; `src/runtime/shared/types/options.ts:6`; `src/runtime/shared/types/log.ts:46-60`; `src/runtime/logger/client/index.ts:136, src/runtime/logger/server/index.ts:68`; `node_modules/consola/dist/core.mjs:2,15`; `docs/reference/log-levels.md:1-20`

**Inspired by.** pino multi-target per-target `level`; LogTape per-category `lowestLevel`; OpenTelemetry Logs SeverityNumber/SeverityText

**Reviewers.** Two reviewers paired DX-3 and the severity fix explicitly, because until a level option exists the verbose method is dead code either way and the new table has to decide what to do with it. OBS-1's values were adopted over ARCH-6's (verified here: both silent and verbose are ±Infinity, not -1). Marked breaking because `lvl` values change for verbose/silent, so it needs R2's schema version first. The per-transport `minLevel` half of DX-3 moved to R20.

#### R17. Logger-core hygiene: one getFrogger, an encapsulated console reporter, an honest reset()

**P1 · small · code-health** · merged from ARCH-7, ARCH-9

**Problem.** Three small contract violations in one file pair. (a) module.ts:403-417 switches the `getFrogger` auto-import between server/utils/auto.ts and manual.ts; comment-stripped, their bodies are identical and only the overload declaration order differs. (b) The constructor already holds a `private consoleReporter` field but still adds it through the public `addReporter()` (base-frogger.ts:113-115,128-129), so it lands in the same `customReporters` array as user reporters: `getReporters()` leaks an internal object and `clearReporters()` silently kills console output as an undocumented side effect. (c) `reset()`'s JSDoc says it "will clear all reporters and context" (types.ts:257-261) while the implementation (base-frogger.ts:353-358) clears neither reporters nor, per one reviewer, anything the doc claims - a test calling reset() between cases accumulates reporters forever.

**Proposal.** (a) Delete both files; add one `src/runtime/server/utils/get-frogger.ts` with both overload orders declared on a single implementation (h3's `isEvent()` brand check already disambiguates the argument positions) and register it unconditionally. Do **not** add a runtime branch for `autoEventCapture`: module.ts:208 sets `nitroConfig.experimental.asyncContext = autoEventCapture`, so with it off Nitro has no async context, `useEvent()` throws, and the try/catch yields undefined - the option genuinely works, structurally. Correct AGENTS.md and ROADMAP D1, which both mislabel it. Add a test asserting both overload orders resolve. (b) Stop the `addReporter(this.consoleReporter)` call; have `emitToReporters` invoke the console reporter first, then the user list. (c) Make `reset()` match its JSDoc or fix the JSDoc to match the code, with a test either way.

**Evidence.** `src/runtime/server/utils/auto.ts:25-85 vs manual.ts:31-91 (comment-stripped diff)`; `src/module.ts:208,403-417`; `src/runtime/logger/base-frogger.ts:62,113-115,128-129,353-358`; `src/runtime/logger/types.ts:257-261`; `test/logger/scrub-options.nuxt.test.ts (imports manual.ts only; auto.ts imported by no test)`

**Inspired by.** original

**Reviewers.** One reviewer disproved the advisors' headline claim that `autoEventCapture: false` is a no-op - module.ts:208 disables Nitro's asyncContext, which is what actually disables the capture - so the 'implement or delete the option' half was dropped in favour of correcting the docs. Another reviewer preferred deleting the option outright; the more conservative reading (keep it, correct the documentation) was taken since it demonstrably works. All three reviewers rejected ARCH-9's proposed `consoleOutput: 'pretty'|'json'|'hidden'` modes: `consoleOutput: false` already does exactly what 'hidden' would, documented at module-options.ts:76-95, and a 'json' mode is only worth building as a real stdout transport (R20).

#### R18. Batch every breaking change into one 0.2.0, with a migration page and a compatibility declaration

**P1 · medium · release-engineering** · after R2

**Problem.** Nine accepted items here change observable behaviour or wire shape (R4 lvl values, R5 signal handlers, R8 errorCapture defaults, R12 rate-limit keying, R26 spanId meaning, R27 exception ctx shape, R34 tags removal, plus the deferred apiKey build error and the setFroggerMetricsUser rename), and another six change the record schema additively. The package is at 0.1.25; README already documents a "Migrating to 0.2.x (breaking)" section for changes that have already shipped, and CHANGELOG.md has no entry for it. No advisor addressed sequencing. Separately, there is no deprecation mechanism at all - no `@deprecated` convention in src/, no one-shot warning helper, no support window - so the "keep a thin deprecated adapter for one minor version" clauses in three proposals are not executable. And `defineNuxtModule`'s meta block (module.ts:67-70) sets only name and configKey with no `compatibility` field, while package.json declares no `nuxt` peerDependency at all, even though @nuxt/kit ^4.4.8 is a runtime dependency and AGENTS.md still says Nuxt 3.

**Proposal.** Cut one 0.2.0 that carries every breaking item behind a single migration page, with R2's `meta.schema` bumping exactly once so nuxt-observe can branch on old-vs-new rather than sniffing fields, and pin a minimum nuxt-observe version against it. Add a `compatibility: { nuxt: '^4.0.0' }` meta field and a `nuxt` peerDependency range so an incompatible install fails at install time, not at first request - this also pins the Nitro hook availability that R22 depends on. Add a `@deprecated` convention plus a one-shot `froggerInternal.warn` helper, or delete the deprecation clauses and take the breaks cleanly here. Backfill the missing CHANGELOG entry for the already-shipped transports break.

**Evidence.** `README.md "Migrating to 0.2.x" vs CHANGELOG.md (no entry)`; `package.json (version 0.1.25; no `nuxt` peerDependency; exports only '.', './testing', './playwright')`; `src/module.ts:67-70 (meta has no compatibility field)`; `AGENTS.md line 9 ("Nuxt 3 ... @nuxt/kit/nuxt ^3.19")`

**Inspired by.** original (raised as a missing item by two reviewers)

**Reviewers.** Two of the three reviewers raised the un-sequenced breaking-change load as a missing item independently, and one added the absent deprecation mechanism as a separate blocker for three other proposals. The Nuxt compatibility declaration was a third missing item, folded here because it belongs to the same release-hygiene pass and because R22/R23 depend on Nitro hooks nothing currently pins.

#### R19. One typed runtime-config accessor; retire the 69 ts-ignores at their source

**P1 · large · code-health** · merged from ARCH-3

**Problem.** There is no typed access to the resolved config. `grep -rn '@ts-ignore\|@ts-expect-error' src/` returns exactly 69 (re-verified in this pass), and no file declares a `nuxt/schema` module augmentation. Every consumer casts independently: base-frogger.ts:78, client/index.ts:41/46/55/57/65/77, server/index.ts:31/33, server/utils/frogger.ts:22/24/29, auto.ts:54/56, manual.ts:60/62, app/frogger.ts:39, server-log-queue.ts:62, plus every metrics-subsystem config read. module.ts:134-192 hand-builds the public/private split as an untyped object literal, so nothing checks that what the module writes matches what the runtime reads - which is exactly how `public.serverModule` (module-options.ts:193) became a documented option with zero readers anywhere in src/. Three transport files additionally import types through `~/src/...` (memory-transport.ts:5, batch-transport.ts:6, file-transport.ts:12), an alias Nuxt maps to the *consuming app's* srcDir, which resolves today only because this repo is itself a Nuxt app rooted at the same place.

**Proposal.** Declare the resolved shape once and augment Nuxt's schema:

```ts
// src/runtime/shared/types/runtime-config.ts
declare module 'nuxt/schema' {
  interface PublicRuntimeConfig { frogger: FroggerPublicRuntimeConfig }
  interface RuntimeConfig { frogger: FroggerServerRuntimeConfig }
}
```

Add `useFroggerConfig()` and `useFroggerServerConfig()` accessors and replace every cast site. Type `moduleRuntimeConfig` in module.ts:134-192 against the same interfaces so writer and readers are checked against one declaration; delete or implement `public.serverModule` once the type check surfaces it. Fix the three `~/src/...` type imports to relative paths. Add an eslint rule banning new `@ts-ignore` under src/runtime/.

**Evidence.** `69 hits for @ts-ignore/@ts-expect-error across src/ (verified)`; `src/module.ts:134-192`; `src/runtime/shared/types/module-options.ts:193 (public.serverModule, zero readers)`; `src/runtime/logger/_transports/memory-transport.ts:5, batch-transport.ts:6, file-transport.ts:12`; `ROADMAP.md Theme D2`

**Inspired by.** original

**Reviewers.** All three accepted; priority split P0/P0/P1 with one reviewer noting nothing currently breaks for users - took P1, but it is a hard prerequisite for R36 and for every item adding config fields (R4, R10, R20). Effort raised from medium to large by one reviewer who counted ~40 call sites across logger, metrics, rate-limiter and websocket, each of which will surface a real mismatch, with dead `public.serverModule` as the proof. The `~/src/...` alias imports were a separate missing item from one reviewer, folded here as the same class of type debt.

### Theme: Observability of the observability pipeline

Frogger's stated invariant is that a customer log is never silently dropped. Today an unbounded batch buffer, a 100ms websocket throttle, a misconfigured API key and a broken frogger.config.ts all lose data with zero output at the production default level. Bounded queues, counters and a health accessor make the invariant testable.

#### R15. Bounded queues, drop counters, and a health accessor that makes "never silently drop" true

**P1 · medium · reliability** · merged from REL-6, REL-10, ARCH-14 (part a)

**Problem.** Two halves of one problem. (a) `BatchTransport.logs` has no hard cap: `maxSize` (default 200) only triggers `handleMaxSizeReached`, which schedules a flush and returns (batch-transport.ts:111-137); nothing discards. On failure, `handleFlushFailure` retains the full array in a `setTimeout` closure across up to 5 retries at 10s base with exponential backoff (:176-206), so a dead HTTP sink grows the buffer while failed batches accumulate in retry closures until the process dies, taking the app with it. The client queue has the mirror inconsistency: enqueue drops oldest via `slice(-maxQueueSize)` (log-queue.ts:117) while retry overflow drops newest via `slice(0, maxQueueSize)` (:333-335), and `maxQueueSize` is wired to `batch.maxSize` (:101), so it can never exceed one batch. (b) Every loss path reports only through `froggerInternal`, whose resolved production default is silent (internal-log.ts:60-80): client queue overflow, queue dropped on IP block, max retries reached, 4xx drop of the whole queue, BatchTransport retry exhaustion, HttpTransport 4xx drop, websocket throttle drops, and any exception inside `handleLog` (base-frogger.ts:353-368). A misconfigured API key discards 100% of logs in production with literally zero output.

**Proposal.** (a) Adopt OTel BatchLogRecordProcessor's named knobs: add `maxQueueSize` (default ~2048, distinct from `maxSize`/`maxExportBatchSize`); on overflow drop oldest and increment a counter rather than growing. Cap total in-flight retry batches (e.g. 3). Give the client queue its own `maxQueueSize` decoupled from `batch.maxSize`, and unify both overflow paths on one documented drop-oldest policy. (b) Add a module-level `froggerHealth` record (`{enqueued, delivered, dropped: {overflow, rateLimited, rejected4xx, retriesExhausted, pipelineError}, lastError, lastErrorAt}`) incremented at each site above, exposed via an exported `getFroggerHealth()` on both runtimes and included in `getReporterInfo()` (also fix that method's declared `downstreamReporters?: string[]`, which is assigned `IFroggerTransport[]` behind an `any` at server-log-queue.ts:355-374). Emit one throttled, ungated `console.warn` the first time `dropped` becomes non-zero. Two named sub-items: fix resolve-options.ts's validation warnings (:294,344,396,405,519), which are gated on the module-level `currentLevel` that `configureInternalLog()` never sets during module setup, by mirroring module.ts:119's local `allowInternal()`; and make `loadFroggerConfig` (frogger-config.ts:9-40) fail the build on a broken frogger.config.ts instead of warning invisibly and silently reverting to a different configuration.

**Evidence.** `src/runtime/logger/_transports/batch-transport.ts:111-137,176-206`; `src/runtime/app/services/log-queue.ts:101,116-119,159-161,322-326,333-336`; `src/runtime/shared/utils/internal-log.ts:60-80`; `src/runtime/logger/base-frogger.ts:353-368`; `src/runtime/server/services/server-log-queue.ts:355-374`; `src/runtime/shared/utils/resolve-options.ts:294,344,396,405,519 vs src/module.ts:119`; `src/runtime/shared/utils/frogger-config.ts:9-40`

**Inspired by.** OpenTelemetry BatchSpanProcessor's maxQueueSize/maxExportBatchSize and explicit drop-count policy; prom-client self-metrics

**Reviewers.** Merged REL-6 and REL-10 because the latter depends on the former and they touch the same code. All three reviewers accepted both. ARCH-14's unique contribution - the misgated resolve-options warnings - was folded in as a named sub-item at two reviewers' request. One reviewer added the frogger.config.ts hard-fail as a missing item, arguing correctly that there is no scenario where silently continuing with different behaviour is what the user wanted. One reviewer asked that the optional "emit frogger.logs.dropped as a metric" be dropped or carefully guarded: emitting metrics about a failing pipeline through that pipeline is a feedback loop, and the counters already carry the information. Elaborate per-retry accounting and level-aware overflow preferences were cut as premature.

#### R16. Delete the dead websocket query scaffold; coalesce instead of dropping batches

**P1 · small · remove-or-shrink** · merged from ARCH-8, REL-13

**Problem.** The dev-only websocket subsystem is ~2,000 lines carrying a large amount that never executes. websocket/types/messages.ts (270 lines) defines HistoricalLogMessage, HistoricalLogResponse, QueryCancellationMessage, QueryStatusMessage, StorageStatusMessage and six type guards; none appear in `WebSocketLogHandler.routeMessage`'s switch (log-handler.ts:64-81, which handles ping/update_filters/get_status/change_channel only), and the only importer in the repo is a 1,115-line test file. websocket/deduplicator/index.ts (299 lines) has zero src/ call sites and 734 lines of tests. `reconnectSubscription` (websocket-transport.ts:318-372) is never called. `maxConcurrentQueries`, `maxQueryResults`, `defaultQueryTimeout` and `cache` are documented at docs/guides/live-logs.md:145-154 and read nowhere. Meanwhile the class that does the broadcasting has no direct test, silently drops whole batches on a bare 100ms per-channel gate (`continue` at :440-441, gate at :657-667) with no counter in `getStatus()`, and writes a live `Map<string, Peer>` into Nitro KV on `Math.random() < 0.1` (:161-197, :445-449) that JSON-serialises to `{}` and that `loadPersistedData` (:79-107) never reads back.

**Proposal.** One subtraction pass: delete websocket/deduplicator/**, the historical-query message types and guards, `reconnectSubscription`, the four unread WebsocketOptions fields, the subscriber-Map persistence write and its `Math.random() < 0.1` trigger, plus their ~1,850 lines of tests. Then one fix: replace the throttle-drop with coalescing - hold a per-channel pending buffer, and on the throttle boundary send the accumulated rows in one frame (capped, dropping oldest beyond that with a `dropped: n` field so a client can render a gap marker) - and surface `droppedBatches`/`droppedRows` from `getStatus()`. Add the first direct unit test for channel/filter/throttle behaviour. Correct docs/guides/live-logs.md.

**Evidence.** `src/runtime/websocket/types/messages.ts (only importer: test/websocket/messages.test.ts)`; `src/runtime/websocket/deduplicator/index.ts (zero src/ call sites, 734 lines of tests)`; `src/runtime/websocket/log-handler.ts:64-81`; `src/runtime/logger/_transports/websocket-transport.ts:79-107,161-197,318-372,440-449,657-667`; `src/runtime/shared/utils/resolve-options.ts:151-153`; `docs/guides/live-logs.md:136-159`

**Inspired by.** original

**Reviewers.** All three verified every deletion target; one called it the largest pure-subtraction item on the list. All three rejected the second half of ARCH-8 (repositioning the socket as a generic DevTapSink over three signal pipelines) because it makes a small deletion depend on the R36 refactor and adds a streaming surface nobody asked for. `breaking` corrected to false by one reviewer: none of these types are in package.json's exports map, so no consumer can reach them. REL-13 was folded in as the coalescing half, since two reviewers judged it the same one-pass change.

#### R21. Reorder the test backlog by trust boundary, then ratchet

**P1 · large · testing** · after R16 · merged from ARCH-16

**Problem.** Coverage is inverted relative to risk. The two largest test files in the repo exercise unreachable code (test/websocket/messages.test.ts, 1,115 lines; test/websocket/deduplicator.test.ts, 734 lines). Meanwhile no test imports src/module.ts, src/runtime/server/api/logger.post.ts, or anything under src/runtime/rate-limiter/ - the module's entire conditional wiring, its one publicly exposed handler, and its DoS boundary. Of the seven log transports, only http and memory have specs: file rotation, BatchTransport's sortingWindowMs and drain() (documented as safety-critical for shutdown), and websocket-transport.ts (882 lines) are unverified. ROADMAP D4's end-to-end client->ingest->file flow is still absent. vitest.config.ts enables coverage with no `thresholds` block, so none of this blocks a PR. Theme A's acceptance criteria ("a default dev start emits at most one Frogger line; a production build emits zero") exist only as prose verified by hand.

**Proposal.** In order: (1) a module.ts setup harness - one spec calling `setup()` against a stubbed @nuxt/kit and asserting which handlers, plugins and imports were registered for a given options object; build this *before* R20, R22, R23 and R14 add branches to that file, since it is the only thing that catches an option silently ceasing to register a handler (the class of defect that produced dead `public.serverModule`). (2) An H3-level test of logger.post.ts covering oversize body, rate-limit rejection, loop detection and relay pass-through - this would have caught R3. (3) The rate limiter's limit math and escalation. (4) BatchTransport `drain()` on shutdown, explicitly including SIGTERM mid-flush, `process.exit()` before the queue drains, and an HTTP request in flight at teardown - the single most-reported failure class in comparable libraries. (5) FileTransport date and size rotation. (6) One end-to-end client -> ingest -> memoryTransport flow through the real route. (7) A quiet-by-default regression test booting the basic fixture and asserting the console-line count, since R15's ungated warning, R9's build warning and R22's instrumentation all threaten the theme the author cared most about. (8) A recorded client-bundle size baseline (bare install / minimal / metrics on) with a CI check, as the guardrail that keeps "pay for what you use" honest as opt-in collectors accumulate. Delete R16's dead-code tests in the same pass, then set `thresholds` in vitest.config.ts at the honest post-cleanup number - last, or it locks in a number computed over dead code. Add the micro-benchmark harness from R31 here too.

**Evidence.** `test/websocket/messages.test.ts (1115 lines), test/websocket/deduplicator.test.ts (734 lines)`; `no test imports src/module.ts, src/runtime/server/api/logger.post.ts, or src/runtime/rate-limiter/**`; `test/ has specs for http-transport and memory-transport only`; `vitest.config.ts (coverage enabled, no thresholds block)`; `ROADMAP.md Theme A acceptance criteria, Theme D4`

**Inspired by.** pino's exit-flush issue history (#1400, #1429, #1662, #1774) as a named, testable failure class

**Reviewers.** All three accepted the trust-boundary reordering. One reviewer promoted the module.ts setup harness from "part of a large program" to a small prerequisite that must land before four other accepted items add branches to that file. Two reviewers added the quiet-by-default regression test as a missing item, arguing it protects the roadmap theme the author cared most about and is directly threatened by three other accepted items. One added the client-bundle budget as the mechanism that keeps every "it's opt-in and lazily imported" claim honest. All three agreed the thresholds ratchet must be set last.

#### R32. Retry only the downstream that failed

**P2 · medium · reliability** · after R2, R21 · merged from REL-7 (retry half)

**Problem.** `BatchTransport`'s default `onFlush` maps every downstream to `reporter.logBatch(logs)` under `Promise.all` and rethrows on the first failure (batch-transport.ts:52-68). If a file transport succeeds and an HTTP transport 502s, the retry re-delivers the entire batch to both - duplicate lines in the log file, duplicate rows in the memory store, and a duplicate POST if the first attempt actually landed but the response was lost. `HttpTransport` retries the same body up to `maxRetries` (:258-289) with a fresh `batch-${Date.now()}-${random}` id per attempt (:156), so an idempotent receiver cannot dedupe either. A flaky egress link turns a 200-log batch into 400-1000 stored rows, silently inflating any count or error-rate derived from them.

**Proposal.** Change `onFlush` to `Promise.allSettled` and retry only the downstreams that actually failed, tracking retry state per `(batchId, transportId)` rather than per batch. Land R21's `drain()` tests first, since this changes what a partial failure means to shutdown, which is documented as safety-critical. Add a stable `x-frogger-batch-id` (uuidv7, constant across retries of the same body) as a cheap follow-on - it is inert until a receiver implements idempotency, which no current transport target does. R2's per-record `id` is the dedupe key readers should actually use, and should be documented as such in R34.

**Evidence.** `src/runtime/logger/_transports/batch-transport.ts:52-68,176-205`; `src/runtime/logger/_transports/http-transport.ts:156,258-289`; `src/runtime/shared/types/log.ts:19-33`

**Inspired by.** OTLP record identity; Sentry envelope item ids

**Reviewers.** All three accepted the allSettled half. Two reviewers downgraded the `x-frogger-batch-id` header to a follow-on, noting it is inert without a cooperating receiver and that frogger's own ingest generates a fresh id per attempt today. The `id` field itself was pulled forward into R2 so the envelope changes once.

### Theme: A data model a reader can index

The wire format is the real public API because nuxt-observe is a separate project. It needs a version, a resource block, correlation keys, a real span record and one normalised exception shape before 1.0 freezes any of it.

#### R2. Version the wire envelope and give every record a stable id

**P0 · small · interoperability** · merged from OBS-7, ARCH-10 (versioning half), REL-7 (id half)

**Problem.** `LoggerObjectBatch.meta` carries `{processed, processChain, source, time}` with no schema version, and `MetricObjectBatch.meta` mirrors it (src/runtime/shared/types/batch.ts:19-24, http-transport.ts:116-126). Because nuxt-observe is a separate project consuming this format, and because at least six accepted items here change record or envelope shape (severity, resource, correlation keys, span identity, exception shape, event kind), a reader has no way to branch other than sniffing for field presence. Separately, `LoggerObject` has no `id` (log.ts:19-33), so nothing downstream can deduplicate a batch that was retried after a lost response - and `trace.spanId` cannot serve as one because it is chained and repeats across relay hops.

**Proposal.** Add `meta.schema: string` ('frogger.logs/1', 'frogger.metrics/1') written by every batch constructor (addBatchMetadata at http-transport.ts:116-126, log-queue.ts:293, and the metrics equivalents), bumped on any field removal or semantic change; additive fields do not bump. In the same envelope change, add `id: string` to `LoggerObject` and `MetricObject`, generated at record-construction time with the already-vendored `uuidv7()` (src/runtime/shared/utils/uuid.ts) - time-ordered, so it doubles as a sort and dedupe key, and preserved unchanged across relay hops.

**Evidence.** `src/runtime/shared/types/batch.ts:19-24`; `src/runtime/logger/_transports/http-transport.ts:116-126`; `src/runtime/shared/types/log.ts:19-33`; `src/runtime/shared/utils/uuid.ts`

**Inspired by.** OTLP's /v1/logs path versioning; Sentry's independently published envelope spec; GlitchTip pinning to that spec rather than SDK internals

**Reviewers.** Reviewers unanimously called this the cheapest item on the list and a strict prerequisite for every shape change; one raised it to P0 explicitly on the grounds that it must land before, not after, the changes it exists to signal. The `id` half was pulled forward from REL-7 on a reviewer's note that the envelope should change once rather than twice. ARCH-10's version of this idea was dropped in favour of OBS-7's placement in `meta`.

#### R10. Introduce a real resource block: environment, release, instance id

**P0 · medium · architecture** · after R2 · merged from OBS-2

**Problem.** The entire identity model is `source: {name, version}` on a row (log.ts:26-29) and `app: {name, version}` on the batch (batch.ts:15-18), both parsed from one `app` option. Grepping src/module.ts and resolve-options.ts for NODE_ENV, `environment`, `deployment.environment` or `release` returns nothing. So staging and production rows shipped to the same sink are indistinguishable; "did this error start after the last deploy", usually the first question asked of any telemetry, is unanswerable by construction; and two Nitro instances behind a load balancer look identical, so a fault localised to one node reads as a fault in the app. `env: 'ssr'|'csr'|'client'|'server'` is a runtime *phase* field and is regularly mistaken for a deployment environment.

**Proposal.** Resolve a resource object once at module setup, serialise it into both public and private runtime config, and stamp it on the batch envelope (not per row) for both pipelines:

```ts
resource: {
  'service.name': app.name,
  'service.version': app.version,
  'deployment.environment': options.environment ?? process.env.NUXT_FROGGER_ENVIRONMENT ?? (nuxt.options.dev ? 'development' : 'production'),
  'service.release': process.env.NUXT_FROGGER_RELEASE ?? app.version,
  'service.instance.id': process.env.NUXT_FROGGER_INSTANCE_ID ?? uuidv7(), // server only, per boot
}
```

Add `resource?: Record<string,string>` to `LoggerObjectBatch` and `MetricObjectBatch`, denormalised onto rows at ingest exactly the way `MetricContext` already is (the `??=` pattern in server-metrics-queue.ts). Keep `source` unchanged for one release; document `resource` as the field readers should key on. The `NUXT_FROGGER_*` env overrides are the point: they let one build be promoted across environments without a rebuild.

**Evidence.** `src/runtime/shared/types/batch.ts:13-25`; `src/runtime/shared/types/log.ts:26-29`; `src/runtime/app-info/parse.ts:1-30`; `src/module.ts (no NODE_ENV/environment/release reference)`; `src/runtime/shared/utils/resolve-options.ts (same)`

**Inspired by.** OpenTelemetry Resource (service.name/version/instance.id, deployment.environment); Sentry's release/environment/dist trio

**Reviewers.** Accepted by all three, one calling it the best item in the set on value-per-risk: additive, non-breaking, resolved once, stamped on the envelope rather than per row. One reviewer trimmed the key set to four plus a server-only instance id and dropped the `VERCEL_GIT_COMMIT_SHA` fallback in favour of one documented `NUXT_FROGGER_RELEASE`. Land with R2 so the envelope changes once. Prerequisite for R28.

#### R24. Give log rows the correlation keys metric points already have, and one identify() verb

**P1 · medium · BREAKING · architecture** · after R2, R10, R22 · merged from OBS-3, DX-5

**Problem.** `MetricObject` carries `session: {id, sampled}`, `user?: string` and a `route` label, each with a documented rationale (metrics/shared/types/metric.ts:66-85). `LoggerObject` carries none of them (log.ts:19-33). The session mechanism exists but is namespaced to metrics only (metrics/app/session.ts, key `frogger:metrics:session`), and route capture lives in the metrics client plugin. So a log emitted during a broken checkout cannot be joined to the LCP gauge from the same page load, cannot be filtered to one user, and cannot be grouped by route - and ROADMAP E's per-user/per-session timelines are not implementable without every app author threading these into `ctx` by hand, which is exactly the per-app configuration this library exists to avoid. On the identity side there is half an API: `setFroggerMetricsUser` is auto-imported client-only (module.ts:385, metrics/app/utils/metrics.ts:91), sets a string on the metrics queue, and has no logging or server counterpart.

**After v0.1.26.** Metrics side only: user is a top-level MetricObject field, denormalised at ingest. LoggerObject still has no session/user/route; session is still metrics-namespaced; no identify(). setFroggerMetricsUser is now a released client auto-import with no server counterpart, so the free rename window closed. Server metrics are permanently user-less: MetricStamp.user is populated by neither runtime binding.

**Proposal.** Promote session out of the metrics subsystem into `src/runtime/shared/session.ts` (same uuidv7 + sessionStorage decide-once logic, key `frogger:session`), consumed by both pipelines. Add three optional **top-level** fields to `LoggerObject` - `session?: {id, sampled}`, `user?: string`, `route?: string` (matched pattern, never a raw path) - not `ctx` keys: `ctx` is user-owned and scrubbable, whereas these are the reader's index keys and must be guaranteed present and never scrubbed. Record that carve-out as an explicit invariant in AGENTS.md alongside scrub precedence. Ship in two waves: `session` and `user` now (both available today), `route` after R22 gives it a server-side producer - shipping it earlier guarantees it is server-side-undefined, which is the trap R34 exists to fix for `tags`. Promote identity to the ambient facade on both runtimes as `frogger.identify(user: string | {id, ...} | null)`: on the client it stores on the app-scoped logger's globalContext and forwards to the metrics queue's existing `setUser`; on the server it stores on the per-request logger cached on `event.context`, so it is request-scoped and cannot leak across requests. Deprecate `setFroggerMetricsUser` - it is uncommitted working-tree code, so the rename costs nothing now. Seed server-side `session` from an `x-frogger-session` header, length-capped and shape-checked the way `parseTraceparent` validates trace ids, since it is unvalidated client input.

**Evidence.** `src/runtime/shared/types/log.ts:19-33 vs src/runtime/metrics/shared/types/metric.ts:66-85`; `src/runtime/metrics/app/session.ts`; `src/runtime/metrics/app/plugins/metrics.client.ts:62-101`; `src/module.ts:385, src/runtime/metrics/app/utils/metrics.ts:91-93`; `ROADMAP.md Theme E`

**Inspired by.** OTel semantic conventions for session.id / user.id; Datadog setUser; Sentry scope.setUser; Faro setUser

**Reviewers.** OBS-3 was taken as canonical over DX-5 by two reviewers, on the argument that shipping identity without session and route solves a third of the join problem; DX-5's `identify()` API was folded in since both add a `user` field and doing them separately risks adding it twice with different semantics. One reviewer flagged the `x-frogger-session` header as unvalidated client input needing the same treatment as trace ids, and asked that "never scrubbed" be written into AGENTS.md as a deliberate invariant. Another required splitting `route` out until R22 exists. `breaking` is DX-5's rename only, which costs nothing pre-release.

#### R25. One normalised exception shape, plus a capture-mechanism tag and a grouping fingerprint

**P2 · medium · interoperability** · after R8, R2 · merged from OBS-8, OBS-9

**Problem.** Error shape is invented per capture site. global-error.server.ts:44-52 writes `{message, stack, origin, uncaught, name, cause}` at the root of ctx for uncaught exceptions, :59-79 writes a different shape for rejections (with its own H3Error branch), :101-142 a third for the Nitro error hook, and `serializeError` (normalize-errors.ts:61-78) a fourth. A reader must special-case all four. There is no `escaped` distinction between "thrown and handled here" and "propagated out", which is the distinction that matters for triage, and no mechanism tag separating "the app deliberately logged an error" from "this crashed uncaught". Nothing groups two occurrences of the same error, so "this happened 4,000 times" requires every reader to invent its own heuristic.

**Proposal.** Funnel all capture paths through one `serializeError` emitting nested, collision-free keys:

```ts
ctx.exception = { 'exception.type', 'exception.message', 'exception.stacktrace', 'exception.escaped' }
ctx.mechanism = 'onerror' | 'unhandledrejection' | 'vue-errorHandler' | 'nitro-error-hook' | 'manual'
```

Ship **additively** for one release, keeping the current flat keys, rather than as a break. As a second phase, derive an advisory `exception.fingerprint` in the same function: a stable key from `name` + a message template (uuids -> `<uuid>`, digits -> `<n>`, quoted strings -> `<str>`) + the first app frame. Restrict the frame component to server-origin errors or make it optional - browser stacks are minified at capture time, so keying on chunk hashes would split one error into a new group per deploy. Honour a `ctx.fingerprint` override and state in the wire-format reference that it is a hint a reader may regroup on.

**Evidence.** `src/runtime/server/plugins/global-error.server.ts:44-52,59-79,101-142`; `src/runtime/shared/utils/normalize-errors.ts:61-78`; `src/runtime/app/plugins/global-vue-errors.ts`

**Inspired by.** OTel semconv exceptions (exception.type/message/stacktrace/escaped); Sentry's capture-mechanism tag; Rollbar's client-sent fingerprint overriding server grouping

**Reviewers.** Two reviewers changed this from breaking to additive-for-one-release, calling the `breaking: true` label self-inflicted since the flat keys cost nothing to keep. Both also stripped the HTTP and Web Vitals renaming out of OBS-8 - the HTTP semconv keys ride with R22 and browser.web_vital with R30 - so there is one naming decision per file rather than one breaking pass blocking three features. Sequence after R8, which is separately rewriting what the server error path puts in ctx. OBS-9's fingerprint was folded in as phase two, downgraded to advisory, with two reviewers rejecting reuse of `simpleHash` (32-bit, birthday collisions merge unrelated errors) and one flagging the minified-client-stack problem.

#### R26. Make spanId stable for the life of a span instead of advancing it per log

**P1 · epic · BREAKING · architecture** · after R2, R18 · merged from OBS-4, OBS-14

**Problem.** `generateTraceContext()` (base-frogger.ts:173-197) mints a fresh spanId and mutates `this.lastSpanId` on every single log call, then stamps `{traceId, spanId, parentId}` on the row. No two logs ever share a spanId, and `parentId` describes "the log that happened immediately before on this instance", not "the unit of work that contains me". `createChildTraceContext()` (:414-419) snapshots whatever `lastSpanId` happens to be, so the parent edge a `span()` gets depends on how many logs the parent emitted first - an order-dependent side effect. A reader wanting "all logs inside span X" must walk a flat parent chain across thousands of rows and guess at boundaries. Span-scoped queries, per-span error rates and any waterfall are impossible to compute, and it silently breaks the one thing W3C trace context is for. Metric exemplars inherit the damage: `traceFromLogger` (metrics/shared/api/trace-of.ts:11-21) round-trips through `getHeaders()`, which returns `lastSpanId`, so the spanId half of every exemplar is close to meaningless - its own docstring concedes it.

**After v0.1.26.** outgoingSpanId() with reservedSpanId/hasEmitted fixes the specific bug where a request issued at the top of a span became its sibling (9 new tests in test/logger/span-parentage.nuxt.test.ts). The thesis stands: generateTraceContext still mints a fresh spanId per log and mutates lastSpanId; child parent edges are still order-dependent; parentId is not renamed.

**Proposal.** Each logger instance owns ONE stable spanId minted at construction. Every log it emits carries `{traceId, spanId: <this logger's span>, parentSpanId: <the span that created this logger>}`. `child()`/`span()`/`startSpan()` mint a new spanId whose parent is the creating logger's stable spanId - a real tree, deterministic regardless of log ordering. Keep `lastSpanId` only for the SSR->CSR handoff via `frogger-ssr-trace-state`, where "continue from the last server span" is the correct semantic. Rename `parentId` to `parentSpanId` on the wire while taking the break. Once landed, fix `traceFromLogger` to read the stable spanId directly rather than round-tripping through header generation, add the sampled flag to the exemplar (`trace?: {traceId, spanId?, sampled?}`), and make `span.duration` histograms carry the exemplar of their own span rather than the ambient one - a span's latency measurement pointing at a different span is the worst case of the bug.

**Evidence.** `src/runtime/logger/base-frogger.ts:173-197,414-419`; `src/runtime/logger/client/index.ts:120-153, server/index.ts:49-87`; `src/runtime/metrics/shared/api/trace-of.ts:11-21`; `src/runtime/shared/utils/span-metric-sink.ts`

**Inspired by.** W3C Trace Context / OpenTelemetry span identity semantics; OpenMetrics exemplars

**Reviewers.** Accepted by all three, with the shared argument that nothing correct depends on today's edges, which is precisely what makes the break acceptable pre-1.0. Effort raised from large to epic by one reviewer who enumerated four places assuming per-log advancement: ServerFroggerLogger's consume-incoming-context branch, ClientFrogger's SSR handoff useState, `getHeaders()`'s parentSpanId, and the metrics exemplar path. One reviewer noted the direction is already being explored in the working tree (`reservedSpanId`/`hasEmitted` fields no method reads yet). OBS-14 was folded in as the near-free follow-on; its closing proposal to emit OpenMetrics exemplars on histogram bucket lines was dropped by two reviewers, since there is no exposition path in this package by design.

#### R27. Emit a first-class Span record instead of overloading the log schema

**P2 · large · new-feature** · after R26 · merged from OBS-5, ARCH-2

**Problem.** A span's only representation as a unit is an optional log row emitted by `finish()` in span-events.ts:92-113 (`msg=name, ctx={spanEvent:'end', durationMs, ok}`). Everything a span model needs and a log row cannot express is absent: no start timestamp (only end minus a duration the reader must subtract), no SpanKind, no status beyond a boolean, no span-scoped attribute bag distinct from log context, no span events. Nested span names overwrite each other in `ctx.span` because explicit child options win the defu merge (client/index.ts:227-239, server/index.ts:106-122), so only the innermost name survives on any row. And with `spans: false` plus a silent body, a span that did real work leaves zero trace anywhere.

**After v0.1.26.** Spans now emit a duration histogram even with span rows off (frogger.span(name, fn, { metric: true })) and durations use a monotonic clock. No SpanObject, no start timestamp, kind, status or attribute bag; nested span names still overwrite each other in ctx.span.

**Proposal.** Add a `SpanObject` wire type and carry it in the **existing** batch envelope - `interface LoggerObjectBatch { logs: LoggerObject[]; spans?: SpanObject[] }` - so no new route, no new transport and no generic pipeline are needed:

```ts
interface SpanObject {
  traceId: string; spanId: string; parentSpanId?: string
  name: string; kind: 'internal' | 'server' | 'client'
  startTime: number; endTime: number
  status: { code: 'unset' | 'ok' | 'error', message?: string }
  attributes?: Record<string, string | number | boolean>
}
```

`runSpanWithEvent` already computes start/end/ok and already has the `onEnd` indirection proven by span-metric-sink.ts - reuse exactly that shape (`setSpanSink(fn)`) so the logger tree still imports nothing new. Add `setAttribute(k,v)` on the object `startSpan()` returns, writing to the span's own bounded bag rather than the child logger's context. Adopt OTel's status total order: once `error`, a later `ok` cannot downgrade it. Keep the span-end log row unchanged for one release.

**Evidence.** `src/runtime/shared/utils/span-events.ts:70-125`; `src/runtime/shared/utils/span-metric-sink.ts:1-32 (wired at base-frogger.ts:389-397, server/index.ts:163, client/index.ts:266)`; `src/runtime/logger/client/index.ts:227-239, server/index.ts:106-122`; `src/runtime/shared/types/batch.ts:13-25`

**Inspired by.** OpenTelemetry Span data model (SpanKind, SpanStatus total order, attributes distinct from log body)

**Reviewers.** All three reviewers selected OBS-5 over ARCH-2 and called the batch-envelope decision the one that makes the feature affordable at all - ARCH-2 gated the same outcome on the R36 refactor. Hard-depends on R26: starting earlier means the emitted SpanObject's spanId is the same order-dependent value the model is trying to fix. Two reviewers narrowed SpanKind to internal/server/client initially and required the attribute bag be bounded so a span cannot become an unbounded payload.

#### R34. Publish the wire format as a spec, with a reader contract, and delete the phantom `tags` field

**P2 · small · BREAKING · docs** · after R2, R10, R11, R24, R26 · merged from OBS-16, ARCH-10 (docs half), OBS-13

**Problem.** Because nuxt-observe is a separate project, the wire format is frogger's real external API, yet it is documented only as incidental TypeScript interfaces. No document states which fields a reader may assume present: is `source` always there (no - undefined when `app` is unset)? Is `trace` always there (yes)? Is `ctx` post-scrub (only sometimes, depending on the SCRUB_HANDLED stamp)? Meanwhile `LoggerObject.tags?: string[]` is declared (log.ts:25), documented in two places, and consumed end to end by the websocket filter and `useFroggerWebSocket().tags([...])` (websocket-transport.ts:557-558,644-646,877-878) - and set by no code path in base-frogger.ts or either subclass, so tag filtering silently matches nothing. And docs/getting-started.md:464 still shows multi-hop tracestate accumulation the runtime never produces.

**Proposal.** Write docs/reference/wire-format.md as a first-class spec page, versioned alongside `meta.schema` (R2), with a table per field: name, type, always-present, who stamps it (emitter / ingest / transport), safe to index, scrubbable. State explicitly the guarantees a backend gets with zero per-app configuration: every row has `time`, `sev`/`type`, `msg`, `env`, `trace.traceId`, `trace.spanId`, and `resource['service.name']` / `resource['deployment.environment']`; `ctx` is user-owned and may be arbitrarily shaped; `session`/`user`/`route` are the reader's index keys and are never scrubbed. In the same pass, delete `tags`, the websocket filter that consumes it, and its documentation references. Write the page *after* R10, R11, R24 and R26 land, or it documents a schema about to change four times. Re-verify the doc-drift list first: one reviewer confirmed docs/reference/logger-api.md:187 already documents TraceContext correctly, so the UUID/flags-array claim is stale, while the getting-started tracestate claim is still wrong.

**Evidence.** `src/runtime/shared/types/log.ts:15-16,25`; `src/runtime/logger/_transports/websocket-transport.ts:557-558,644-646,877-878`; `src/runtime/app/composables/useFroggerWebSocket.ts:75-77`; `src/runtime/logger/base-frogger.ts:154-171`; `docs/getting-started.md:464`; `docs/reference/logger-api.md:187`

**Inspired by.** Sentry's independently published envelope spec; GlitchTip pinning to that spec rather than SDK internals

**Reviewers.** The spec page is OBS-16 and ARCH-10's second half, merged; two reviewers said write it last, after the schema stops moving. On `tags`, reviewers split: two preferred populating it from the child/span scope chain (which also fixes the nested-span-name overwrite), one preferred deletion on the grounds that a per-row string array duplicates what R27's parentSpanId tree carries structurally and commits to a second scope-encoding scheme before the first has settled. Took the more conservative option - delete now, add deliberately later if a user asks for free-form tagging. All three agreed on the one thing that must not happen: shipping 1.0 with a documented, filterable field no code writes.

### Theme: Free signal: automatic collection

"All-in-one performance tracking" currently means five Web Vitals and whatever the developer hand-instruments. One Nitro afterResponse hook, one fetch interceptor and one perf_hooks collector turn frogger from a manual library into the automatic one its description promises.

#### R22. Automatic per-request instrumentation from Nitro's response hooks

**P1 · medium · new-feature** · after R18 · merged from DX-1, ARCH-13, OBS-11, DX-15

**Problem.** Frogger holds the H3 event for the entire request and never times it. trace-headers.server.ts:12 hooks only `request` (to seed trace context); nothing in src/ hooks `beforeResponse` or `afterResponse`. So the single most valuable server signal - per-route latency, status, error rate - is absent from a package advertising performance tracking, and users get it only by manually wrapping every handler in `frogger.span(...)`. The metrics subsystem's own option docs concede this (metric-options.ts:16: "Heavier auto-collection ... gets its own phase"). It is also why R24's `route` field has no server-side producer.

**Proposal.** One Nitro plugin, registered alongside trace-headers.server.ts, owning the request root span:

```ts
nitroApp.hooks.hook('request', e => { e.context.frogger.rootSpan = { name: routePatternOf(e), start: monotonicNow() } })
nitroApp.hooks.hook('afterResponse', e => emitRequest(e, { 'http.request.method', 'http.route', 'http.response.status_code' }))
```

Record `http.server.request.duration` as a histogram in seconds via the existing span-metric-sink indirection (so the logger tree still never imports the metrics tree), using OTel's HTTP bucket set `[0.005,0.01,0.025,0.05,0.075,0.1,0.25,0.5,0.75,1,2.5,5,7.5,10]`. The route label MUST be the matched route pattern (`event.context.matchedRoute?.path`), never `event.path` - and if the pattern is unavailable for a request, drop the measurement rather than falling back to the raw URL, which is the cardinality explosion express-prom-bundle exists to retrofit around. Self-exclude `/api/_frogger/*`. Expose `frogger:span:start` / `frogger:span:end` Nuxt hooks so nuxt-observe or a user plugin can rename or annotate without reaching into internals. As a second, dev-only output of the same per-request registry, set `Server-Timing: validate;dur=12.4, db;dur=53.1` on `beforeResponse` from the completed spans' durations (span-events.ts:100 already computes them from a monotonic clock), truncated to the top N spans and off by default in production since it leaks internal phase names.

**Evidence.** `src/runtime/server/plugins/trace-headers.server.ts:12`; `src/runtime/metrics/shared/types/metric-options.ts:16`; `src/runtime/shared/utils/span-metric-sink.ts (wired at base-frogger.ts:389-397 -> server/index.ts:163)`; `src/runtime/shared/utils/now.ts`; `src/runtime/shared/utils/span-events.ts:92-113`; `src/module.ts:400-407`

**Inspired by.** nitro-opentelemetry's request/beforeResponse/afterResponse span lifecycle; OTel http.server.request.duration semantic convention; express-prom-bundle's route-pattern rule; W3C Server-Timing and Hono's timing middleware

**Reviewers.** All three reviewers selected DX-1 over ARCH-13 and OBS-11 specifically because it does not gate itself on the span-model rewrite: a histogram plus a log row is shippable today, and putting the highest-value missing feature behind an epic is the wrong order. Two reviewers required verifying `event.context.matchedRoute?.path` is populated on the targeted Nitro version and dropping the measurement rather than falling back to `event.path`. On defaulting: one reviewer wanted it off to hold the quiet-by-default line, another wanted it on whenever `metrics` is already enabled since the user has chosen to pay - the more conservative reading (default off, one flag, documented prominently) was taken. OBS-11's `frogger:span:*` hooks and DX-15's Server-Timing output were folded in; DX-15 is only small *after* this lands, since the per-request span registry it needs does not exist today.

#### R23. Auto-propagate trace headers into $fetch with a same-origin allow-list

**P1 · medium · new-feature** · after R13 · merged from DX-2

**Problem.** ROADMAP B2, the last unshipped ergonomics item, undercuts the library's headline feature. Cross-boundary correlation requires `$fetch(url, { headers: logger.getHeaders() })` at every call site; `getHeaders()` (base-frogger.ts:154-171) is the only producer and nothing calls it automatically. There is no ofetch interceptor anywhere in src/runtime/app/plugins/. A developer who adopts the ambient facade specifically to stop holding a logger variable is forced to hold one again at exactly the request whose latency and failure they most want correlated.

**Proposal.** A client plugin registering an ofetch `onRequest` interceptor, gated on `tracePropagation?: false | { urls?: (string|RegExp|((url:string)=>boolean))[] }` and defaulting to same-origin only. Same-origin default is the safety property that matters: a naive global patch leaks internal trace ids to every third-party endpoint the page calls - document that regex matchers must be anchored, since Datadog's unanchored-regex incident came from exactly this. Per-call escape hatch: `$fetch(url, { frogger: false })`. The interceptor resolves the ambient logger the way `getAmbientClientLogger()` does (active span wins, then app-scoped) so headers carry the enclosing span. Ship the client half first; treat the server-side Nitro-to-Nitro wrapper as a separate follow-up, because `globalThis.$fetch` is process-shared and per-request header injection needs the AsyncLocalStorage context in active-context.server.ts - getting that wrong leaks one request's trace id into another's outbound call.

**Evidence.** `ROADMAP.md:76-82`; `src/runtime/logger/base-frogger.ts:154-171`; `src/runtime/app/plugins/ (no ofetch interceptor)`; `src/runtime/logger/active-context.client.ts`

**Inspired by.** Datadog Browser RUM allowedTracingUrls + traceContextInjection; Elastic APM RUM distributedTracingOrigins

**Reviewers.** Accepted by all three. One reviewer split off the server-side $fetch wrapper as materially harder and a separate follow-up, on the async-context-leak risk. Another added a dependency on R13, since propagating a hardcoded '01' flags byte defeats the purpose.

#### R30. Metrics depth: server runtime stats from perf_hooks, and Web Vitals attribution

**P2 · medium · new-feature** · after R29 · merged from DX-16 (runtime half), DX-10, DX-14 (longTasks half), ARCH-13 (runtime-metrics rider)

**Problem.** Two collection gaps at opposite ends. Server-side there is nothing: grepping src/runtime/metrics for `perf_hooks`, `monitorEventLoopDelay`, `eventLoopUtilization` or `memoryUsage` returns nothing, so "my Nuxt server got slow but no individual route did" - the question R22 explicitly cannot answer - has no signal at all. Client-side, web-vitals.ts:91 dynamically imports the plain `web-vitals` build and records only value/rating/delta/navigationType, which tells a developer "LCP was 3.2s" and nothing about why, even though the already-installed dependency (`web-vitals ^5.3.0`) ships an `attribution` entry point carrying, for LCP, the target selector plus timeToFirstByte/resourceLoadDelay/resourceLoadDuration/elementRenderDelay, and for INP, interactionTarget/inputDelay/processingDuration/presentationDelay plus the longest blocking script.

**Proposal.** (a) `metrics: { runtime: true }` - a Nitro plugin using `monitorEventLoopDelay({resolution:20})` read on an interval for p50/p90/p99, `eventLoopUtilization()` deltas, a `PerformanceObserver({entryTypes:['gc']})` for GC pause duration by kind, and heap usage, all from node:perf_hooks with zero new dependencies, feeding frogger's own histogram/gauge facade. Adopt @opentelemetry/instrumentation-runtime-node's metric names and units verbatim (`nodejs.eventloop.delay.p99` gauge in seconds, `nodejs.eventloop.utilization`, `v8js.gc.duration`, `v8js.memory.heap.used`) so no translation table is needed downstream. (b) `metrics: { webVitals: { attribution: true } }` swaps the dynamic import to `web-vitals/attribution` and spreads the attribution object into the existing non-indexed `MetricObject.attr` slot - no cardinality cost, which is exactly what the labels/attr split was built for. Default off so the attribution build's weight is opt-in. Optionally add a feature-detected `long-animation-frame` observer (Chrome 123+, falling back to `longtask`) emitting a blocked-duration histogram with script attribution in `attr`.

**Evidence.** `src/runtime/metrics/** (no perf_hooks reference anywhere)`; `src/runtime/shared/utils/now.ts (only feature-detects the global performance)`; `src/runtime/metrics/app/collector/web-vitals.ts:33-37,91`; `package.json (web-vitals ^5.3.0 already a dependency)`; `src/runtime/metrics/shared/types/metric.ts:87-92 (attr is the non-indexed slot)`

**Inspired by.** @opentelemetry/instrumentation-runtime-node metric names; Node perf_hooks monitorEventLoopDelay/eventLoopUtilization; web-vitals/attribution; Chrome Long Animation Frames API

**Reviewers.** Two reviewers independently split DX-16 and said its buried second half - runtime metrics - is the larger win and the single biggest confirmed gap in the metrics subsystem; the userTiming bridge was demoted to a later P3 and is not carried here. DX-10 was accepted by all three as the cheapest real capability gain available (a one-import swap). One reviewer moved the `browser.web_vital.*` semconv renaming out of DX-10 and into R25's naming pass so there is one decision, not two. DX-14's resourceTiming collector was rejected by one reviewer and cautioned by both others - it indexes on URL origin, stores full URLs in `attr` (a new PII surface in a pipeline whose scrubber has no value-pattern matching), needs its own threshold and sample rate, and can generate a self-sustaining feedback loop against the ingest POST - so only the LoAF half survives, as optional.

### Theme: Destinations without lock-in

The custom-transport escape hatch is written, works, and is reachable by nobody: not exported, not auto-imported, not documented, while a build warning tells users to call it. Plus a stdout sink for the hosts solo devs actually deploy to, and an OTLP body shape that reaches most backends at once.

#### R20. Publish the transport contract, add per-transport thresholds, and ship a stdout sink

**P1 · medium · interoperability** · after R4, R19 · merged from ARCH-4, DX-9 (part 1)

**Problem.** Three related gaps that together mean frogger can only ship where frogger already runs. (a) The extension point works and is reachable by nobody: `IFroggerTransport`, `BaseTransport`, `addGlobalTransport()` and `createHttpTransport()` (server/utils/transport.ts:12-45) are the only way to write a Datadog/Loki/Seq destination, and module.ts:253 emits a build warning telling users to do exactly that - yet none appear in module.ts's export block (26-52), in any `addServerImports` call (403-450, which register only getFrogger/HttpTransport/frogger/froggerMetrics), or in package.json's three exports subpaths (verified: '.', './testing', './playwright'), and docs/guides/transports.md never names them. (b) `BatchTransportOptions.levels` (batch-transport.ts:17, applied :94-109) is a real filter but is an exact-membership `number[]` reachable only from `createBatchTransport(this.downstreamTransporters)` (server-log-queue.ts:85), called with no options, so "warn+ to this HTTP sink, everything to the file" is inexpressible. (c) A bare install persists nothing, and the two documented options are a local file (which dies with the container on Fly, Railway, Render, Cloud Run and every serverless preset) or an HTTP endpoint the user must stand up. Console output is a reporter, not a transport: no JSON mode, no batching, no level filter, not a member of the FroggerTransportConfig union.

**Proposal.** (a) Export `IFroggerTransport`, `BaseTransport`, `addGlobalTransport`, `createHttpTransport` from module.ts, add a `./transport` subpath to package.json and build.config.ts, add `addGlobalTransport` to the server auto-imports, and write docs/guides/custom-transports.md with one complete worked example, the lifecycle contract (`log`/`logBatch`/`flush`/`destroy`, must never throw into the caller, must stay cheap) and the registration call. (b) Add `minLevel?: LogType` to every `FroggerTransportConfig` variant with threshold semantics, keep `levels?: number[]` as the low-level escape hatch, and thread the resolved value into each constructed transport in `buildConfiguredTransports` (server-log-queue.ts:103-140). (c) Add `stdoutTransport()` - roughly thirty lines against the same `IFroggerTransport` contract, JSON-lines to fd 1, works on every Nitro preset including edge, needs no user infrastructure, and is read for free by Vector, Fluent Bit, Promtail and every platform's own log view.

**Evidence.** `src/runtime/server/utils/transport.ts:12-45`; `src/module.ts:26-52,253,403-450`; `package.json exports (verified: 3 subpaths)`; `src/runtime/logger/_transports/batch-transport.ts:17,94-109`; `src/runtime/server/services/server-log-queue.ts:85,103-140`; `src/runtime/logger/base-frogger.ts:113-115 (console is a reporter, not a transport)`

**Inspired by.** pino multi-target per-target `level`; winston-transport's documented subclass contract; LogTape's per-category lowestLevel; the twelve-factor stdout convention

**Reviewers.** Part (a) was accepted unanimously and called the cheapest lock-in fix available; two reviewers wanted it shipped alone first since it is small and non-breaking. Part (b) was gated by one reviewer on R4 landing first, because a minLevel threshold built on today's level table would be wrong for two of thirteen levels. Part (c) was raised as a missing item by one reviewer and is arguably the highest-value piece: it is the only zero-infrastructure persistence that survives a deploy on the hosts solo devs actually use, and it sidesteps R6's preset problem entirely. The same reviewer warned that a `consoleOutput: 'json'` reporter mode is not a substitute, since it bypasses transports, batching and level filtering.

#### R28. An OTLP body shape, and a decision on the dead `vendor` option

**P2 · medium · interoperability** · after R4, R10, R11 · merged from ARCH-5, OBS-12, DX-9 (part 2)

**Problem.** `FroggerTransportConfig` has exactly four kinds - http, file, observe, memory (transports.ts:154-158) - and `HttpTransport` always POSTs the proprietary `{logs, app, meta}` envelope (http-transport.ts:107-153) regardless of configuration. The `vendor` option is declared (:19), defaulted (:45), assigned into `this.options` (:81) and **never read again**: `createRequestHeaders` hardcodes `vendorData: { frogger: this.transportId }` at :204. It is plumbed all the way through the declarative config and resolve-options.ts:312, so users can set an option with literally no effect. Net result: pointing frogger at an OTel Collector, Grafana Alloy, Loki, Axiom, Better Stack or Datadog requires the user to stand up a translating proxy, which contradicts the zero-setup positioning.

**Proposal.** Add a pure mapping step immediately before `performHttpRequest`, selected by `httpTransport({ endpoint, shape: 'frogger' | 'otlp-logs' })`, so all existing retry/backoff/chunking/4xx-drop logic is reused unchanged. Ship `otlp-logs` only - one shape reaches the Collector, Alloy, SigNoz, Datadog, Axiom, Better Stack and ClickStack at once, and each additional shape is a wire format frogger must then keep correct forever. No `@opentelemetry/*` dependency; it is a nested object literal:

```ts
{ resourceLogs: [{ resource: { attributes: kvList(batch.resource) },
  scopeLogs: [{ scope: { name: 'nuxt-frogger', version },
    logRecords: batch.logs.map(l => ({ timeUnixNano: String(l.time * 1e6), observedTimeUnixNano: String((l.obsTime ?? l.time) * 1e6), severityNumber: l.sev, severityText: l.type, body: { stringValue: l.msg }, traceId: l.trace.traceId, spanId: l.trace.spanId, attributes: kvList(flatten(l.ctx)) })) }] }] }
```

Default stays `'frogger'`. In the same change, either wire `vendor` into the tracestate token or delete it from the config union - a documented option with no effect is the same class of defect as dead `public.serverModule`. Add `otlp-traces` once R27 lands.

**Evidence.** `src/runtime/shared/types/transports.ts:154-158`; `src/runtime/logger/_transports/http-transport.ts:19,45,81,107-153,204`; `src/runtime/shared/utils/resolve-options.ts:312`

**Inspired by.** OTLP/HTTP JSON spec; GlitchTip's strategy of being wire-compatible rather than SDK-compatible

**Reviewers.** Priority lowered to P2 by two reviewers: the file/observe paths already work and this is optionality, not a defect. All three carried over OBS-12's correction of the dependency chain, which ARCH-5 got wrong - OTLP needs severityNumber (R4), a resource block (R10) and observedTime (R11), and shipping before them produces a payload with a null severity and no service.name. One reviewer removed ARCH-5's stated dependency on R20, which is not actually required for a shape flag on the existing transport. Two reviewers rejected shipping Loki/Datadog shapes speculatively. The dead `vendor` option was a missing item from one reviewer, who noted two advisors mis-described it as "only used to label the tracestate".

#### R36. Extract the shared batch, file and http sink cores (scoped)

**P2 · large · architecture** · after R6, R15, R19, R21 · merged from ARCH-1

**Problem.** The library duplicated along the wrong axis: metrics is a line-for-line retype of the log pipeline rather than a second instantiation of one pipeline. batch-metrics-transport.ts (263 lines) mirrors batch-transport.ts (324) feature-for-feature including the insertSorted binary search, sortingWindowMs grace and retry map; file-metrics-transport.ts (262) mirrors file-transport.ts (291) down to the identical `require('node:fs')` rotation body; http-metrics-transport.ts (234) mirrors http-transport.ts (304); server-metrics-queue.ts (307) mirrors server-log-queue.ts (390). The two transport interfaces differ only in method names (`log`/`logBatch` vs `metric`/`metricBatch`); everything else is identical. Every fix to timer, retry, backoff, rotation or beacon logic must be applied twice - R6 is the proof, since the same rotation corruption exists in both copies.

**Proposal.** Scope this down hard from the advisor's proposal. Extract exactly the three pieces that are genuinely identical: a generic batching/retry core (`BatchPipeline<T>` with a `timeOf(record)` accessor), a `FileSink<T>` (rotation + buffered JSON-lines), and an `HttpSink<T>` (retry, 4xx drop, chunking), each parameterized by record type behind the existing two interfaces. Leave the two client queues alone: metrics-queue.ts carries session sampling, a per-page event cap and beacon budgeting that log-queue.ts does not, so "line-for-line" overstates them. Drop the SignalDescriptor/three-signal generalisation and the deprecated-adapter migration, which the package has no mechanism to express. Sequence strictly after R6 (rotation), R15 (bounded queues) and R21's transport tests - unifying two untested transports that both contain a corrupting bug hoists the bug into one class with no safety net. Migrate metrics first: smaller surface, opt-in, so a regression is contained.

**Evidence.** `src/runtime/metrics/_transports/batch-metrics-transport.ts (263) vs src/runtime/logger/_transports/batch-transport.ts (324)`; `src/runtime/metrics/_transports/file-metrics-transport.ts:187 vs src/runtime/logger/_transports/file-transport.ts:215 (identical require)`; `src/runtime/metrics/app/services/metrics-queue.ts (492) vs src/runtime/app/services/log-queue.ts (494)`; `src/runtime/logger/_transports/types.ts:1-14 vs src/runtime/metrics/_transports/types.ts:1-15`

**Inspired by.** Datadog's split @datadog/browser-logs + @datadog/browser-rum built on one shared internal transport core

**Reviewers.** All three reviewers accepted the duplication as real and all three rejected the P0/epic framing: this is a pure refactor with zero user-visible value that would freeze the fourteen defect fixes above it, and the transports it would unify are exactly the ones with a corrupting bug and no tests. Downgraded to P2/large by unanimous agreement. Two reviewers cut the two client queues out of scope on the grounds they are not actually equivalent. All three dropped the deprecated-adapter clause: there is no deprecation convention, no warning helper and no exports subpath to publish one on (see R18). The R19 dependency was confirmed hard by two reviewers - a generic pipeline cannot be written against `any`.

### Theme: Volume, cost and cardinality levers

Between "log everything" and "uninstall" there is currently only a reactive 429. Deterministic tail sampling, per-transport thresholds, dedupe-able record ids and a metric cardinality guard give a solo dev on a metered host a way to keep frogger in production.

#### R13. Honour and propagate the W3C sampled flag instead of fabricating it

**P1 · small · reliability** · merged from OBS-10, ARCH-15 (flags half), REL-11 (flags half)

**Problem.** Three links in the chain are broken. The Nitro request-hook plugin hand-rolls `traceparent.split('-')` (trace-headers.server.ts:17-26) instead of calling the already-tested `parseTraceparent`/`isValidTraceId`/`isValidSpanId`, and never extracts the flags byte into `event.context.frogger`. `generateW3CTraceHeaders` defaults `sampled = true` and nothing in base-frogger.ts:154-171 ever passes otherwise, so an upstream service's "not sampled" decision is silently upgraded on every hop through a Nuxt app. And neither `createLoggerObject` writes `flags` onto the row, so a reader cannot filter on it. Separately, `extractTraceContext` (trace-headers.ts:227-235) parses an incoming tracestate into a `stateData` variable it never uses, and docs/getting-started.md:464 documents multi-hop tracestate accumulation the runtime never produces.

**Proposal.** Three small fixes. (1) Replace the hand-rolled parse in trace-headers.server.ts with `extractTraceContext()`/`parseTraceparent`, which already validate id shapes, and store `flags` on `event.context.frogger`. (2) Thread the incoming flags through `ServerFroggerLogger`'s trace continuation so `getHeaders()` re-emits the same flags byte rather than a hardcoded '01'. (3) Include `flags` in the `TraceContext` written onto every LoggerObject. Either merge an incoming tracestate in `getHeaders()` or correct the getting-started example. Document plainly that frogger propagates a sampling decision and does not make one - until R33 lands.

**Evidence.** `src/runtime/server/plugins/trace-headers.server.ts:11-35`; `src/runtime/shared/utils/trace-headers.ts:197-209,227-235`; `src/runtime/logger/base-frogger.ts:154-171`; `src/runtime/shared/types/trace-headers.ts:24`; `docs/getting-started.md:464`

**Inspired by.** W3C Trace Context flags byte; OTel sampling-decision propagation

**Reviewers.** All three reviewers pulled this out of the three duplicate sampling proposals and insisted it ship independently and first: it deletes duplicated parsing rather than adding surface, is a strict correctness win with or without a sampling feature, and is the prerequisite for R33. One reviewer supplied the honest-docs framing.

#### R29. Enforce metric identity: kind lock and a cardinality overflow bucket

**P2 · medium · reliability** · merged from OBS-15, DX-13 (cardinality half)

**Problem.** Three guarantees are asserted in comments and enforced nowhere. `MetricKind` is documented as "Locked at definition - never inferred, never changed after the fact" (metrics/shared/types/metric.ts:15), but `froggerMetrics.counter('x', 1)` in one file and `froggerMetrics.gauge('x', 5)` in another produce a mixed-kind series no reader can safely aggregate - `buildMetric` (build-metric.ts:14-52) validates only that the name is non-empty and value/time finite. `unit` is a free string, so 'ms', 'millisecond' and 'second' coexist under one name. And `MetricLabels` says "NEVER ids, urls or free-form user input" while nothing stops `labels: { userId }`; `maxEventsPerPage` caps total points, not distinct label combinations, so one careless label explodes the series count in whatever sink receives the JSON lines.

**Proposal.** (1) Keep a process-local `Map<name, {kind, unit}>` in the facade; on mismatch, emit one throttled internal warning naming both call sites and drop the conflicting point rather than corrupting the series. (2) Port OTel's overflow algorithm: track distinct label fingerprints per name and, past a default cap (200, configurable), keep recording the *value* but replace labels with `{ overflow: true }` plus one warning - never silently drop the measurement, which is the failure mode the overflow bucket was designed to avoid. (3) For `unit`, warn once per unknown value and record the point; do not narrow to a closed union.

**Evidence.** `src/runtime/metrics/shared/types/metric.ts:15,19-22`; `src/runtime/metrics/shared/api/build-metric.ts:14-52`; `src/runtime/metrics/app/services/metrics-queue.ts:83-85`

**Inspired by.** prom-client's constructor-time metric definition; OpenTelemetry SDK cardinality limits with the otel.metric.overflow bucket

**Reviewers.** All three reviewers took OBS-15 over DX-13 and all three rejected OBS-15's part (2): narrowing `unit` to a closed union would reject the existing `''` for CLS-style unitless metrics and every legitimate UCUM annotation, and `buildMetric` returning null silently loses the measurement. Warn-don't-reject was adopted. DX-13's `defineFroggerSchema()` was rejected by two reviewers as exactly the ceremony the ambient facade exists to remove; only its runtime cardinality guard survives, and it duplicates OBS-15's part (3).

#### R31. First-class activity events: `frogger.event(name, ctx)`

**P2 · small · new-feature** · after R2 · merged from DX-7

**Problem.** ROADMAP.md:3-8 says the author "has used it across many production projects and still reaches for hand-rolled 'activity event systems' instead". That is a product signal. An activity event ('order.placed', 'plan.upgraded') is neither a log line (it is a business fact, not diagnostic text) nor a metric (it carries high-cardinality detail like an order id). Today it must be squeezed into `frogger.info('order placed', { orderId })`, where it competes with debug chatter for level thresholds and transport budget and cannot be separated downstream.

**Proposal.** Add `frogger.event(name: string, attributes?: Record<string, unknown>)` to the ambient facade on both runtimes. It emits a normal LoggerObject, reusing the entire existing pipeline (scrub, batch, transports, trace correlation), but stamps a `kind: 'event'` discriminator with `msg = name`, so a reader can split business facts from diagnostics with one predicate and a transport can route them separately once R20's `minLevel` lands. Emit at `info`. Record the discriminator in the wire-format reference (R34) so nuxt-observe can rely on it.

**Evidence.** `ROADMAP.md:3-8 (verified verbatim)`; `src/runtime/logger/ambient.ts:20-49`; `src/runtime/shared/types/log.ts:19-32`; `src/runtime/logger/base-frogger.ts:118-126,244-246`

**Inspired by.** Datadog addAction; New Relic addPageAction; Faro pushEvent; evlog's wide-event thesis

**Reviewers.** All three accepted, one calling it the cheapest item that directly addresses the author's own stated reason for reaching past the library. All three rejected the proposal to exempt events from the level threshold, for two separate reasons: it cannot be done as described, because the threshold is enforced by consola before `handleLog` ever runs (base-frogger.ts:118-126), so a bypass means routing around `this.consola` entirely; and an unsilenceable log kind is a footgun for exactly the metered-host solo dev R33 exists to protect. Emit at info and leave the threshold alone.

#### R33. Tail sampling with force-keep rules, decided deterministically from the trace id

**P2 · medium · new-feature** · after R13, R22, R26 · merged from DX-8, ARCH-15, REL-11

**Problem.** The only volume controls are the log level (a severity threshold) and the ingest rate limiter (a reactive burst cap that 429s). Neither answers "keep 100% of errors and slow requests, drop 90% of routine 200s". The failure mode is concrete: a traffic spike makes the limiter start 429ing, the client queue backs off and then drops its whole buffer (log-queue.ts:172-183), losing precisely the error logs that explain the spike, while routine info logs consumed the budget. For a solo dev on a metered host, "turn logging down without turning it off" is the difference between keeping frogger in production and removing it.

**Proposal.** `sampling?: { rate?: number, keep?: ... }`, evaluated once per completed unit of work - a request root span (R22) or an explicit `span()` - not per log line. Any keep rule wins first and always: warn/error/fatal rows, a failed span, `ctx.forceKeep`. Ship the simplest surface (a rate number plus built-in keep rules) before any predicate API; default `rate: 1`, no behaviour change. The load-bearing detail: make the decision deterministic from a hash of the trace id rather than a fresh `Math.random()`, so the same trace samples identically on both sides of a client/server hop - without it the feature produces half-traces, which is worse than not sampling. Retain all log rows carrying a kept span's spanId.

**Evidence.** `src/runtime/app/services/log-queue.ts:172-183`; `src/runtime/rate-limiter/index.ts:283-330`; `src/runtime/shared/utils/trace-headers.ts:197-209`

**Inspired by.** evlog's SamplingConfig (probabilistic rate + force-keep predicates); Sentry's sampleRate vs tracesSampleRate split; PostHog's deterministic hash-of-session-id sampling

**Reviewers.** DX-8 was selected as canonical over ARCH-15 and REL-11 by all three reviewers, solely because it specifies the deterministic hash - the detail that makes the feature work across a hop. Priority lowered to P2 by two reviewers. All three added the sequencing DX-8 omitted: R13 must land first (a sampling feature that cannot honour or emit the flags byte is a local-only decision) and there is no unit of work to attach to until R22 and R26 exist. Two reviewers rejected the proposal to rewrite metrics/app/session.ts's persisted random draw: a session's sampling decision is per-session and long-lived, while a trace id is per-request, so hashing the trace id there would re-decide sampling on every request and destroy the decide-once property that file exists to provide. REL-11's 429-storm rationale was carried over.

#### R35. Scrubber depth: opt-in value patterns, message scanning, and an honest hash

**P2 · medium · security-privacy** · after R8 · merged from REL-14 (remainder)

**Problem.** Three remaining gaps after R8 closes the container-traversal hole. (1) `scrubLoggerObject` walks only `logObj.ctx` (scrubber/index.ts:198-220); `msg` is never inspected, so `logger.info('user ' + email + ' logged in')` ships PII to every transport and the dev websocket. This is documented at docs/guides/scrubbing.md:25-27, but it remains the single most common way PII enters logs. (2) Matching is key-name only (findRule, :72-97), so `ctx.notes = 'card 4111111111111111'` or a JWT in `ctx.details` passes untouched. (3) `SCRUB_STRATEGY.HASH` is a 32-bit unsalted rolling hash (strategies.ts:157-164) applied by RECOMMENDED_RULES to `ssn`/`socialSecurity` - brute-forceable in milliseconds for a nine-digit input, while reading to a user as "irreversible". There is also no way to compose RECOMMENDED_RULES with an exception.

**Proposal.** (1) Add opt-in `scrub.values: true | ValuePattern[]` running a small default regex set (email, card shape, `Bearer <token>`, JWT `eyJ…`) over string values regardless of key name, and - under `scrub.message: true` - over `msg`. Both off by default so the zero-config hot path stays cheap; document the per-log CPU cost and defer until R31's benchmark exists. (2) Replace `simpleHash` with a salted 64-bit synchronous hash and rename the strategy's documentation to "pseudonymise", or drop HASH from RECOMMENDED_RULES for `ssn` in favour of redact. Note the constraint the advisor missed: `applyStrategy` is synchronous, so Web Crypto's async digest does not drop in, and node:crypto's sync API is server-only - the browser path needs a different answer. (3) Add a negative-rule form (`.never('supportEmail')`) so RECOMMENDED_RULES can be composed with exceptions.

**Evidence.** `src/runtime/scrubber/index.ts:72-97,198-220`; `src/runtime/scrubber/strategies.ts:157-164`; `src/runtime/scrubber/recommended.ts:31-36`; `docs/guides/scrubbing.md:25-27`

**Inspired by.** pino redact paths; OpenReplay/LogRocket sanitizers; evlog's RedactConfig

**Reviewers.** The container-traversal half moved to R8, where two reviewers said it must ship with the header leak it enables. On the hash, all three reviewers flagged the feasibility problem the advisor missed (synchronous scrub path vs async Web Crypto); two preferred a salted 64-bit synchronous hash plus honest naming, one preferred dropping HASH for ssn entirely - both are recorded. One reviewer required value-pattern scanning stay opt-in and deferred behind a benchmark, since it is a per-log regex pass in the hot path.

## 6. Reconciliation against v0.1.26

Commit 9af3a9e (released as f8732ac): 35 files, +1599/-58, zero changes under docs/. It added (1) the manual metrics API under src/runtime/metrics/shared/api/ (types.ts, build-metric.ts, facade.ts, trace-of.ts) with runtime bindings in metrics/app/utils/metrics.ts and metrics/server/utils/metrics.ts, auto-imported as `froggerMetrics` (both runtimes) and `setFroggerMetricsUser` (client) when metrics are on; (2) span duration histograms via src/runtime/shared/utils/span-metric-sink.ts, a `spans.metric` option and a third `SpanOptions` argument on `span()`; (3) a monotonic clock in src/runtime/shared/utils/now.ts; (4) span-id reservation (`outgoingSpanId()`, `reservedSpanId`, `hasEmitted`) in base-frogger.ts; (5) `LogScrubber.scrubRecord()` and scrub-metric-batch.ts wired into the server metrics queue, plus `user` as a top-level MetricObject/MetricObjectBatch field. AGENTS.md was rewritten; five new test files cover the pure units.

**32 of 36 recommendations are unchanged.** Partially addressed:

- **R1.** AGENTS.md metrics section was rewritten and is accurate; nothing under docs/ changed. docs/guides/metrics.md still denies the userland API v0.1.26 ships and names planned APIs (defineMetric / useFroggerMetrics) that are not the shipped froggerMetrics.
- **R24.** Metrics side only: user is a top-level MetricObject field, denormalised at ingest. LoggerObject still has no session/user/route; session is still metrics-namespaced; no identify(). setFroggerMetricsUser is now a released client auto-import with no server counterpart, so the free rename window closed. Server metrics are permanently user-less: MetricStamp.user is populated by neither runtime binding.
- **R26.** outgoingSpanId() with reservedSpanId/hasEmitted fixes the specific bug where a request issued at the top of a span became its sibling (9 new tests in test/logger/span-parentage.nuxt.test.ts). The thesis stands: generateTraceContext still mints a fresh spanId per log and mutates lastSpanId; child parent edges are still order-dependent; parentId is not renamed.
- **R27.** Spans now emit a duration histogram even with span rows off (frogger.span(name, fn, { metric: true })) and durations use a monotonic clock. No SpanObject, no start timestamp, kind, status or attribute bag; nested span names still overwrite each other in ctx.span.

### Findings in the new code

- **span.duration exemplars point at the parent span** (medium). runSpanWithEvent awaits run() (which is runWithLogger(child, fn)) and only then calls finish(), so the metrics sink fires after the AsyncLocalStorage scope has exited. The stamp resolver reads getActiveLogger() first, which at that moment is the enclosing span, or the request root via event.context.frogger. Every span.duration point is therefore correlated to its parent, and a nested span's latency lands on the outer span. Fix: capture the exemplar inside the runWithLogger scope, or pass the span child into onEnd and derive the trace from it. None of the six onEnd tests asserts which trace the point carries.
  Files: src/runtime/shared/utils/span-events.ts:78-112, src/runtime/metrics/server/utils/metrics.ts:21-45, src/runtime/metrics/app/utils/metrics.ts:47-60, src/runtime/metrics/server/plugins/metrics-queue.server.ts:18-25
- **The facade has no cardinality or identity guards** (medium). buildMetric validates only a non-empty name, a finite value and a positive time. No kind lock (counter("x") and gauge("x") produce one mixed series, contradicting the docstring at metric.ts:15), unit is free text with no warning path, nothing bounds distinct label combinations or key/value length, and labels/attr are stored by reference so a caller mutating the object after recording mutates a point already sitting in a 15s batch window. This is R29 verified against the committed code.
  Files: src/runtime/metrics/shared/api/build-metric.ts:19-52, facade.ts:16-70, types.ts:16-33, metric.ts:15
- **Invalid points vanish with no diagnostic** (medium). build-metric.ts:12-17 justifies returning null so a doomed point is "never dropped silently three hops later", but the facade drops it silently at hop zero: `if (metric) record(metric)` has no else branch and no froggerInternal call, so froggerMetrics.gauge("queue.depth", NaN) is indistinguishable from success. The client out-of-context path logs at debug, which is silent at the production default. Same class of gap as R15, reproduced in new code.
  Files: src/runtime/metrics/shared/api/facade.ts:21-28, build-metric.ts:12-25, src/runtime/metrics/app/utils/metrics.ts:72-79
- **Metric scrubbing covers only the server hop** (medium). scrubMetricBatch runs in ServerMetricsQueueService.enqueueBatch and its docstring calls that "the one hop every point crosses". The client MetricsQueueService holds no scrubber and fans out to browser-direct client transports (observe) alongside or instead of the primary POST. A client metric transport therefore ships raw labels/attr from the manual API, while identical data recorded server-side is redacted. Either wire a scrubber into the client queue or document the carve-out.
  Files: src/runtime/metrics/shared/utils/scrub-metric-batch.ts, src/runtime/metrics/app/services/metrics-queue.ts:55,87,261-275
- **A new public API shipped in a patch release with a one-line changelog and no docs** (medium). v0.1.26 adds two client auto-imports (froggerMetrics, setFroggerMetricsUser), one server auto-import, a third parameter to span(), a spans.metric option and a top-level user field on the metric wire format. CHANGELOG.md says "Metrics enhancements". docs/ does not mention any of it. This is the R18 pattern repeating.
  Files: src/module.ts:379-388,445-451, src/runtime/logger/types.ts:134, CHANGELOG.md
- **web.vital. is a magic prefix, and resetPage() removes the session ceiling** (low). The per-page budget exemption is a raw startsWith("web.vital."), so any app metric named web.vital.custom escapes the only volume guard in the client subsystem. resetPage() on every router.afterEach converts maxEventsPerPage: 500 into 500-per-navigation with no session-level cap behind it, in a subsystem whose ingest route shares the log rate-limit budget.
  Files: src/runtime/metrics/app/services/metrics-queue.ts:32,131-160, src/runtime/metrics/app/plugins/metrics.client.ts:148-155
- **timer()/time() ergonomics** (low). The stop function reads elapsedSeconds(start) before the stopped guard, so a second call returns a longer value that was never recorded. time() hard-codes labels.ok, overwriting a caller-supplied ok label. time() is typed Promise<T> for a sync fn, forcing a microtask onto sync render/serialise paths.
  Files: src/runtime/metrics/shared/api/facade.ts:32-49,56-69
- **Tests stop at the pure units** (low). The five new test files (build-metric, facade, scrub-metric-batch, span-metric-sink, span-options) cover the pure layer. Neither runtime binding (metrics/app/utils/metrics.ts, metrics/server/utils/metrics.ts) is exercised anywhere, which is exactly where the mis-attributed exemplar lives. Nothing covers LogScrubber.scrubRecord directly, ServerMetricsQueueService.enqueueMetric, or the user denormalisation at ingest.
  Files: test/metrics/*, src/runtime/metrics/app/utils/metrics.ts, src/runtime/metrics/server/utils/metrics.ts

## 7. Pipeline re-map additions

The client/server pipeline mapper in the main run returned an empty placeholder, so it was re-run against HEAD after the synthesis. Its findings mostly confirm R3, R7, R11, R12 and R15. Additions, tagged with the recommendation they extend:

- **R3.** processChain can never detect a duplicate: HttpTransport.addBatchMetadata rebuilds meta.processChain as a fresh one-element array on every hop (http-transport.ts:116-126) instead of appending, so the `chainSet.size !== length` check at logger.post.ts:53-57 is unreachable. Only the 5/10-minute staleness heuristic can fire.
- **R12.** The reporter and app rate-limit tiers are decorative for browser traffic: the client's primary POST sends no x-frogger-reporter-id / x-frogger-source headers (log-queue.ts:311-315), so only ip and global can engage. docs/guides/rate-limiting.md presents all four as general.
- **R12.** RetryState.backoffMultiplier is computed on every 429 (log-queue.ts:166,169) but never read; the real delay comes from Retry-After via getRateLimitStrategy. The docs' "backs off with an increasing multiplier" describes dead state.
- **R12.** blockLevel is hardcoded to 0 (response-factory.ts:89, rate-limiter/index.ts:214) so escalation wording never changes; escalationResetHours: 0 defeats escalation (index.ts:126); the cleanup setInterval is never cancelled on resetInstance (index.ts:45-52, 62-64); tier checks run serially for up to 4x KV latency per ingest (index.ts:301-317).
- **R15.** BatchTransport keys flush eligibility off client-supplied log.time (batch-transport.ts:241-249); a future-dated row never becomes eligible and, with no hard cap, sits in the shared process-wide buffer indefinitely. Ties into R11's time clamp.
- **R15.** Exponential backoff is implemented three times (log-queue.ts:188-216, http-transport.ts:258-288, batch-transport.ts:176-206) with no shared helper and no jitter, so multiple instances retry a recovering sink in lockstep.
- **R25.** Browser capture is Vue errorHandler only: no window "error" or "unhandledrejection" listener, and no dedupe/sampling of a tight error loop, which can fill the client queue and trip the limiter before the developer sees the bug. Disclosed in docs/guides/error-capture.md, but a real gap for an all-in-one collector.

Strengths it confirmed: lazily resolved client queue (no boot-order hazard), clean 429 / non-429 4xx / 5xx classification in the client queue, independent secondary-transport fan-out, drain-not-sleep shutdown paths, symbol-stamped error dedupe between handler logs and the Nitro error hook, per-transport try/catch isolation, and `hasPrimaryLogSink` centralising the "is anything persisting" check.

## 8. What other libraries do (lessons that survived review)

Researched: pino, winston, bunyan, roarr, LogTape, tslog, consola, Effect Logger; OpenTelemetry JS (logs/metrics/traces, OTLP, semconv, browser SDK, nitro-opentelemetry, @vercel/otel); Sentry (@sentry/nuxt), Bugsnag, Rollbar, Highlight, GlitchTip; Datadog RUM, Grafana Faro, Elastic RUM, New Relic browser, OpenReplay, PostHog, LogRocket; prom-client, hot-shots, express-prom-bundle, fastify-metrics, Node perf_hooks; evlog and the Nuxt/Nitro module ecosystem; OTLP, Loki, Axiom, Better Stack, Datadog, Seq, ClickHouse/HyperDX, Vector/Fluent Bit ingest APIs.

- pino gates in two stages - the logger's own level first, then each target's `level` (default 'info') - so "warn and above to the HTTP sink, everything to the file" is one word of config. Frogger's `BatchTransportOptions.levels` is an exact-membership `number[]` reachable only from a single process-wide `createBatchTransport` call with no options, so the same request is currently inexpressible (R20).
- pino's own issue history (#1400, #1429, #1662, #1774) makes exit-flush a named, testable failure class rather than an edge case: an async-initialised sink receives writes after teardown has started and the loss is silent. Frogger's `drain()`-on-Nitro-close is the right shape, but R5 shows the library is currently doing the opposite of pino's contract by calling `process.exit()` itself, and R21 makes SIGTERM-mid-flush an explicit test case.
- OpenTelemetry's BatchLogRecordProcessor names four knobs (maxExportBatchSize 512, scheduledDelayMillis 5000, maxQueueSize 2048, exportTimeoutMillis 30000) and, crucially, ships an explicit drop-when-full policy with a count. Frogger has maxSize/maxAge but no maxQueueSize and no counter at all, which is why a dead sink OOMs the process rather than shedding load (R15).
- OpenTelemetry's cardinality-limit design keeps the measurement and replaces the labels with an `otel.metric.overflow` bucket rather than dropping the point. That is the exact algorithm frogger needs for its labels-vs-attr discipline, which is currently enforced only by a doc comment (R29).
- Sentry publishes its envelope format as a standalone versioned spec, not as SDK internals - which is why GlitchTip could implement a from-scratch collector that every Sentry SDK talks to unmodified. Frogger's wire format is its real external API for the same reason (nuxt-observe is a separate project) and currently carries no version and no spec page (R2, R34).
- Datadog Browser RUM's `allowedTracingUrls` exists because a naive global fetch patch leaks internal trace ids to every third-party endpoint a page calls, and their unanchored-regex incident is the cautionary detail worth copying verbatim into the docs. Frogger's ROADMAP B2 needs exactly this allow-list, defaulting to same-origin (R23).
- express-prom-bundle exists almost entirely to retrofit route-pattern normalisation onto raw URLs after the fact - the single most common cardinality footgun in Node metrics. Nitro hands frogger the matched route pattern for free, so R22's rule is: use the pattern, and if it is unavailable, drop the measurement rather than falling back to `event.path`.
- @opentelemetry/instrumentation-runtime-node is a single drop-in that wires Node's own perf_hooks into event-loop delay percentiles, ELU, GC pause and heap metrics. Frogger can emit the same signal set with zero new dependencies by calling `monitorEventLoopDelay` and a gc PerformanceObserver directly, and should adopt its metric names verbatim so nothing downstream needs a translation table (R30).
- evlog - the closest direct prior art, also Nitro-based - separates minLevel (a hard severity threshold) from sampling (probabilistic rate plus force-keep predicates evaluated at emit time). Collapsing the two either loses errors under heavy sampling or fails to control cost at all, which is exactly frogger's current position with only a level and a reactive 429 (R33).
- roarr deliberately ships no in-process transport layer and uses AsyncLocalStorage `adopt()` for ambient context - the same model nestjs-pino reached independently, and the same one frogger's active-context mechanism already implements. That convergence is worth stating in the docs as validation rather than leaving readers to infer it.
- SigNoz measured OpenTelemetry's browser auto-instrumentation at roughly 300KB uncompressed / 60KB gzip, and the documented fixes are per-instrumentation imports and deferred dynamic loading. Frogger's web-vitals collector already does this correctly; R21's bundle-size baseline is what keeps every future "it's opt-in and lazily imported" claim honest.
- web-vitals - already a frogger dependency - ships an `attribution` entry point whose only cost is a different import string, turning "LCP was 3.2s" into the target selector plus timeToFirstByte/resourceLoadDelay/elementRenderDelay. It lands in the non-indexed `attr` slot frogger's labels/attr split already built for exactly this (R30).
- Vercel's `@vercel/otel` exists because even Vercel decided the raw OTel SDK's provider+processor+exporter+resource+propagator assembly needed a one-call facade. That is the DX bar frogger's zero-setup pitch is measured against, and the reason R28's OTLP support should be one `shape` flag on the existing transport rather than an SDK dependency.

## 9. Docs drift

Every place the published docs, README or AGENTS.md disagree with the code. Fix in the R1 pass; ask the maintainer before editing VitePress docs.

- docs/guides/metrics.md:13-15 states "There is no userland metrics API in this release... A manual defineMetric()/useFroggerMetrics() API is planned for a later release", and repeats it at :268, while `froggerMetrics.counter/gauge/histogram/timer/time` is implemented (src/runtime/metrics/shared/api/facade.ts) and auto-imported on both runtimes (src/module.ts:379-388 client, :445-451 server) whenever metrics are enabled. `setFroggerMetricsUser` is likewise shipped and undocumented.
- docs/guides/transports.md:8-34 opens with "File transport (the default)" and a top-level `file: {...}` config key, claiming every ingested log is written to disk by default. resolve-options.ts:522-526 detects that exact key as removed legacy config and warns; a bare install constructs no FileTransport and writes no logs/ directory.
- docs/configuration.md:34 and :93-100 still declare `file?: FileOptions` as a current ModuleOptions field, and the preset table (:240) plus the always-on defaults block (:314-327) both describe file output as always on.
- docs/configuration.md:62-65 and :187-206 type `transports` as an untagged `HttpTransportConfig[]` with no `type` discriminator and no mention of the fileTransport/memoryTransport/observeTransport factories, directly contradicting docs/guides/transports.md, which documents the real tagged union.
- docs/configuration.md's "full interface" omits five real, JSDoc'd ModuleOptions fields entirely: `verbose`, `logLevel`, `spans`, `context` and `metrics` (src/runtime/shared/types/module-options.ts). Only `metrics` is documented anywhere else in docs/.
- docs/configuration.md:68 and :209 type `public.endpoint` as `string`; it is `string | false`, and `false` (disable the client POST while keeping the server route) is documented only in README's 0.2.x migration notes and AGENTS.md.
- docs/configuration.md:73 documents `public.serverModule` as a real option; module-options.ts:193 declares it and nothing in src/ ever reads it - only the top-level `serverModule` key has any effect.
- docs/getting-started.md:494 writes `modules: ['frogger']`; the package and module name is `nuxt-frogger` everywhere else, so the example does not work as printed.
- docs/getting-started.md:464 shows multi-hop tracestate accumulation (`frogger=...,my-other-service=...`) and says each service prepends its own entry. `getHeaders()` (base-frogger.ts:154-171) always writes only frogger's own vendor entry, and the Nitro request hook never reads the incoming tracestate header at all.
- docs/getting-started.md, docs/reference/logger-api.md and docs/guides/live-logs.md all document `tags` - as a LoggerObject field and as a working `.tags(['payment'])` live-log filter. No code path in base-frogger.ts, client/index.ts or server/index.ts ever sets it, so the field is undefined on every real row and the filter matches nothing.
- docs/guides/live-logs.md:145-154 documents `maxConcurrentQueries`, `maxQueryResults`, `defaultQueryTimeout` and a `cache` block as configurable websocket options. They are declared in websocket/types/options.ts and in DEFAULT_WEBSOCKET (resolve-options.ts:151-153) and read nowhere; WebSocketTransport hardcodes its own CLEANUP_INTERVAL/STALE_CHANNEL_TIMEOUT/MESSAGE_RATE_LIMIT constants (:30-32).
- docs/reference/log-levels.md:1-20 documents debug (4) and trace (5) as usable levels without mentioning that BaseFroggerLogger hardcodes a threshold of 3 (base-frogger.ts:68) and that ModuleOptions exposes no way to change it, so both are silent no-ops.
- AGENTS.md line 9 describes the package as "a logging + W3C tracing module for Nuxt 3 (depends on @nuxt/kit/nuxt ^3.19)"; package.json declares @nuxt/kit ^4.4.8 as a runtime dependency, nuxt/@nuxt/schema ^4.4.8 as devDependencies, and no `nuxt` peerDependency at all.
- AGENTS.md and ROADMAP.md D1 both frame auto.ts/manual.ts purely as duplication differing in overload order. The substantive fact is the opposite of what several readers inferred: `autoEventCapture` is not a no-op, because module.ts:208 sets `nitroConfig.experimental.asyncContext = autoEventCapture`, which is what actually disables `useEvent()`. AGENTS.md's metrics section (lines 97-148) also predates the shipped froggerMetrics facade, the `user` correlation field, and the span-metric sink.
- docs/reference/logger-api.md's TraceContext documentation is NOT drifted - line 187 already reads `trace: TraceContext // { traceId, spanId, parentId?, flags? }`. The UUID-shaped-ids and `flags: []`-as-array claims that appear in two advisor reports were verified stale by review and should not be "corrected".
- README.md carries a prominent "Migrating to 0.2.x (breaking)" section for changes already present in the source at version 0.1.25, while CHANGELOG.md has no entry for that breaking change or for any 0.2.0 release.

### Changed by v0.1.26

- FIXED: AGENTS.md metrics section now documents the facade, the correlation stamp order, the user-is-not-a-label rule, span duration via the sink, and metric scrubbing.
- WORSE: docs/guides/metrics.md:13-15 and :268 still say there is no userland metrics API and name defineMetric() / useFroggerMetrics() as planned; the shipped API is froggerMetrics.*.
- NEW: nothing in docs/ mentions froggerMetrics, setFroggerMetricsUser, span.duration, MetricOptions, correlate or the monotonic clock; the JSDoc in src/runtime/metrics/shared/api/types.ts is the only description.
- NEW: maxEventsPerPage is documented as a flat per-page cap; it now resets on every SPA navigation and exempts web.vital.*.
- NEW: metrics.md says a separate metrics rate-limit budget is "planned alongside the manual metrics API"; the API shipped, the budget did not.
- NEW: spans gained a metric sub-key and span() a third argument; docs/configuration.md still omits spans and docs/reference/logger-api.md shows span(name, fn).
- NEW: docs/guides/scrubbing.md has no occurrence of "metric"; server-side metric redaction, its carve-outs (name, user, session) and the client-direct bypass are undocumented.
- STILL DRIFTED: AGENTS.md:9 says Nuxt 3 / ^3.19 against @nuxt/kit ^4.4.8; the ts-ignore count is 69, not "~63"; the auto.ts/manual.ts framing omits that module.ts:208 sets nitroConfig.experimental.asyncContext = autoEventCapture, which is what actually disables capture.

## 10. Dropped proposals (do not re-litigate by accident)

- **REL-16 Offline/crash durability for the client queue via an IndexedDB spillover.** Reviewer-majority rejection (2 of 3 reject, 1 accept-with-changes at P3/large). It adds an IndexedDB subsystem - schema versioning, quota handling, private-browsing and blocked-storage fallbacks, startup replay ordering - to the client bundle of a library whose roadmap's stated product problem is weight, to recover a residual loss that R7's beacon/keepalive path has not yet been given a chance to eliminate. Its own dependency list concedes it needs R7 and R32 first. The `maxQueueSize = batch.maxSize` coupling it cites (log-queue.ts:101) is already fixed for free by R15. It also introduces a new privacy question nobody analysed: log rows containing PII would persist on the user's disk across sessions, interacting directly with R8, R9 and R35. Re-propose only if, after R7 ships, measured loss justifies it.
- **DX-12 / ARCH-14b Nuxt DevTools dock exposing frogger's own pipeline health.** Excluded by the brief's no-UI constraint, and independently weakened by review: one reviewer rejected it outright, and the other two accepted only with a downgrade to P3 and (in one case) a re-estimate from medium to large, noting a DevTools dock is a Vue UI surface with its own build, RPC wiring and dev-only bundling, built against a @nuxt/devtools API whose addCustomTab() is already soft-deprecated in favour of docks.register(). All three agreed its own prerequisite - the drop counters - does not exist yet, so a dock built now would render nothing. R15's `getFroggerHealth()` accessor plus one ungated throttled warning delivers the diagnostic value at a fraction of the cost; if a dock is still wanted afterwards it is a separate package's job.
- **DX-6 Breadcrumb ring buffer attached to error rows.** One reviewer rejected it and the other two downgraded it from P1 to P3 with hard gating. The rejection is the strongest argument: once R24 puts session, user and route on every log row and R26 makes spanId a real key, "what led to this error" is a query nuxt-observe answers over data frogger already ships - breadcrumbs would duplicate that data a second time inside every error payload. The sizing also ignores a hard constraint already in the codebase: logger.post.ts caps a batch at 1 MiB and copying a 30-entry buffer onto every error row multiplies error payloads roughly 30x into the same 413 path that log-queue.ts:322-326 treats as "drop the whole queue". Revisit after R8, R15 and R24 land, if the correlation keys turn out not to be enough.
- **DX-11 SPA view tracking with a route-change-only heuristic.** Dropped because a reviewer verified the premise is false. metrics/app/utils/metrics.ts:26-44 already resolves the route pattern at record time for every manual metric, with a comment explaining why; only the Web Vitals collector freezes the route at init (metrics.client.ts:91-101), and DX-11 itself concedes that freeze is correct and should be preserved. So there is no misattribution bug to fix. What remains is a net-new SPA analytics feature (view counts, navigation duration) that belongs to a product-analytics tool, not a Nuxt observability collector. The two reviewers who accepted it did so at P3 and both required decoupling it from DX-7, which leaves very little.
- **DX-13 (schema half) defineFroggerSchema() typed context and build-time metric registry.** Rejected by two reviewers on the same ground: a declaration file you must author before recording a metric is precisely the ceremony the ambient facade exists to remove, and typed-context augmentation buys type safety over a bag users deliberately kept loose (`LogContext = { [key: string]: any }` is a considered choice for a drop-in console replacement). The third reviewer routed it to OBS-15 as a duplicate. Its one durable idea - the runtime cardinality cap with an overflow bucket - survives in R29.
- **ARCH-11 (core proposal) Replace consola with a frogger-owned internal dispatcher.** Rejected in substance by all three reviewers. It rewrites the hottest path in the library while base-frogger.ts has no direct unit test, it would remove the level taxonomy R4 is about to expose as a public option, and the correctness payoff it claims (the `lvl` corruption) is already fully fixed by R4's one-line table lookup. It also means owning throttling, type normalisation and the browser/basic reporter split consola currently provides. Two surviving fragments were rehomed: the divergent consola type imports across three submodules ('consola', 'consola/browser', 'consola/basic') fold into R19's type-debt pass, and the per-child allocation cost belongs to the deferred benchmark work noted under R21.
- **ARCH-12 (unstorage rebuild) Rebuild FileTransport on Nitro's useStorage().** The preferred proposal was rejected by one reviewer and downgraded to its own stated "minimum viable alternative" by the other two. It is a redesign of the one transport users actually rely on, and it silently changes the feature they rely on it for: size+date rotation becomes key naming, which is not the same artifact - a `logs/2026-06-26.log` tailed by Vector is the entire point of the file sink. It also collides head-on with R6, which rewrites the same function, and depended on the R36 refactor. The minimum-viable half (replace the ESM-hostile `require('node:fs')`, add a build-time error for fileTransport on a non-node preset) is folded into R6.
- **DX-14 (resourceTiming half) Thresholded resource-timing collector.** Rejected by one reviewer and cautioned by both others. It indexes on URL origin and stores full URLs in `attr`, a new PII surface in a pipeline whose scrubber has no value-pattern matching (R35 is opt-in and later); it needs both a duration threshold and its own sample rate, which is volume-management tuning the target user should not have to do; and it is the only proposal in the set that can generate a self-sustaining feedback loop, since a resource entry for the ingest POST produces the next batch which produces the next entry. The cheaper long-animation-frame half survives as an optional part of R30.
- **DX-16 (userTiming half) performance.mark/measure bridge into metrics.** Not rejected, but cut for list size and sequencing: all three reviewers rated it strictly smaller value than the runtime-metrics half of the same recommendation, and one called it speculative about whether the target user already calls performance.measure(). It is a clean, small follow-on to R30 (a PerformanceObserver on `entryTypes: ['measure']` mapped to histograms behind a name-prefix filter) and should be picked up once runtime metrics ship and the metrics docs from R1 are true.

## 11. Method and caveats

One workflow, five phases, 20 agents, then two follow-ups (22 total: 12 Sonnet, 9 Opus, 1 Fable orchestrating).

- **Map (Sonnet x6, read-only):** logger core; client and server pipelines; transports, config and module wiring; metrics; websocket, scrubber, rate limiter, error capture; testing, tests, playground and docs. Structured output: components, data flow, strengths, pain points with file:line and severity, gaps, docs drift.
- **Research (Sonnet x6, web):** Node structured logging; OpenTelemetry JS; Sentry and error monitoring; browser RUM SDKs; metrics and runtime performance; Nuxt ecosystem and collectors. Structured output: libraries, transferable ideas, anti-patterns, sources.
- **Advise (Opus x4, effort high):** architecture and signal model; product, DX and feature gaps; reliability, performance, security and privacy; observability data model and correlation. 64 recommendations with evidence, code sketches, effort, priority, breaking flag.
- **Review (Opus x3, effort high):** code-grounding skeptic (re-verified every problem statement in source, checked AGENTS.md invariants), goal-fit skeptic (collection-only, no UI, solo dev, quiet by default), feasibility and sequencing skeptic. Verdict on all 64 with adjusted priority/effort, plus "missing" items. One recommendation (REL-16, IndexedDB spillover) was rejected by majority.
- **Synthesize (Opus x1):** merged duplicates, applied accept-with-changes amendments, took the more conservative priority where reviewers disagreed, folded in strong "missing" items (R3, R18, R20c, R21 harness, the dead `vendor` option), ranked into 36 items in 7 themes.
- **Orchestrator follow-ups:** re-verified every P0 at HEAD; re-ran the pipeline mapper that returned an empty result; ran an Opus reconciliation of all 36 items against commit 9af3a9e and a review of the new code; verified the span.duration exemplar bug directly.

Caveats: the advisors ran without the pipeline map (its re-run added detail but changed no ranking); research reflects the public web as of August 2026; line numbers drift; priorities are the reviewers' conservative reading. Raw per-phase JSON (maps, research, all 64 pre-review recommendations, the three review verdict sets, synthesis) lived in the session scratchpad and may not survive; the artifact link at the top carries the same content as this file in a browsable form.
