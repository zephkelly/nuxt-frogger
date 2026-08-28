# Changelog

## v0.1.27

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.26...v0.1.27)

### 🚀 Enhancements

- Large range of changes and improvements to metric pipeline ([6d0ebd1](https://github.com/zephkelly/nuxt-frogger/commit/6d0ebd1))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.2.0 (unreleased)

Breaking. See `docs/migration/0.2.md` for the full migration.

### ⚠️ Breaking changes

- **`preset: 'standard'` and `'full'` now actually redact.** Both presets seed
  `RECOMMENDED_RULES`. Previously they resolved to a scrubber with zero rules
  while documenting redaction as on, so a config that looked safe shipped
  plaintext. A bare `scrub: true` still injects no rules, and the build now
  warns when a scrubber resolves to zero.
- **Frogger no longer takes over host shutdown.** The `SIGTERM`/`SIGINT`
  handlers that drained and then called `process.exit(0)` are off by default
  (`errorCapture.server.takeoverSignals: true` restores them), and
  `uncaughtException` no longer forces `process.exit(1)`
  (`errorCapture.server.exitOnUncaught: true` restores it). Nitro's `close`
  hook already drains the queue.
- **Error capture no longer ships secrets by default.** `includeHeaders`,
  `includeComponentProps` and `includeComponentOuterHTML` all default to
  `false`. When headers are enabled, `cookie`, `authorization` and friends are
  replaced with `[redacted]` unconditionally; `outerHTML` is truncated to 4 KiB.
- **`lvl` values changed for `verbose` and `silent`.** They were ±Infinity
  copied off consola, which `JSON.stringify` turns into `null`. `verbose` now
  shares the `trace` tier (5) and `silent` is `-1`. Every level is finite and
  JSON-safe.
- **Rate limiting ignores forwarding headers by default.** `rateLimit.trustProxy`
  defaults to `false` (socket peer only). Set it to `true`, a hop count, or a
  list of trusted peers if you run behind a proxy. The `reporter` and `app`
  tiers are only keyed on when the request is authenticated.
- **Nuxt 4 is now a declared peer dependency** (`^4.0.0`), enforced by the
  module's `compatibility` meta.
- **Removed:** the dead websocket historical-query message types, the
  deduplicator, `reconnectSubscription`, and the unread `maxConcurrentQueries` /
  `maxQueryResults` / `defaultQueryTimeout` / `cache` websocket options. None
  were reachable, and none were in the package exports map.

### 🚀 Enhancements

- **Versioned wire envelope.** Every batch carries `meta.schema`
  (`frogger.logs/1` / `frogger.metrics/1`), and every record carries a uuidv7
  `id` that survives relay hops - a stable dedupe and sort key.
- **Resource block.** Batches carry `resource` with `service.name`,
  `service.version`, `deployment.environment`, `service.release` and a per-boot
  `service.instance.id`, denormalised onto rows at ingest. New `environment`
  option plus `NUXT_FROGGER_ENVIRONMENT` / `NUXT_FROGGER_RELEASE` /
  `NUXT_FROGGER_INSTANCE_ID` env overrides, so one build can be promoted
  across environments without a rebuild.
- **A real `level` option.** `frogger.debug()` and `frogger.trace()` were
  process-wide no-ops with no way to enable them. `level` accepts a level name
  or `{ client, server }`; the default stays `'info'`.
- **OTel `sev` on every row** (trace=1 … fatal=21), derived from `type`.
- **Observed time.** Ingest stamps `meta.received.{at,ip}` and denormalises
  `obsTime` onto each row, mirroring OTel's Timestamp/ObservedTimestamp split.

### 🩹 Fixes

- **Relay batches are no longer rejected.** The ingest route threw 400 on any
  batch carrying `x-frogger-processed`, which `HttpTransport` sets on every
  outgoing batch - so 100% of frogger-to-frogger relay traffic was dropped as a
  4xx. Warnings are now split from rejections, and `processChain` appends
  instead of being rebuilt, so genuine loop detection can actually fire.
- **File rotation no longer corrupts itself.** Rotation renamed the file out
  from under the open write stream and never reset the size counter, so after
  the first rotation every line landed in the renamed file forever. It now
  closes, renames, reopens and resets; rotated names are disambiguated
  (`rename` silently overwrote same-millisecond rotations, destroying whole
  files); the ESM-hostile `require('node:fs')` is gone; and a `fileTransport()`
  against a preset with no filesystem now fails the build instead of failing at
  first write.
- **Client logs survive page exit.** The only exit path was a plain `$fetch` on
  `pagehide`, which browsers cancel at unload. There is now a `sendBeacon` /
  `fetch(keepalive)` ladder on `visibilitychange` and `pagehide`, with beacon
  budgeting and chunk splitting.
- **The scrubber can see inside `Map`, `Set` and `Headers`.** `Object.entries`
  returns `[]` for all three, so they were emitted by reference, unredacted -
  the mechanism behind the header leak.
- **W3C sampled flag is propagated, not fabricated.** Incoming `traceparent`
  ids are validated before adoption, the inbound flags byte is re-emitted
  rather than hardcoded to `01`, and inbound `tracestate` is carried forward
  with frogger's entry prepended.
- **`span.duration` exemplars point at their own span.** The metrics sink fired
  after the span's context scope had exited, so every nested span's latency was
  attributed to its parent.
- **Ingest hardening.** A chunked POST with no `content-length` could skip the
  size guard entirely; the body is now read with a byte counter that aborts at
  the cap. Batches are validated (log count, field types, message size) with
  stable error codes, and a skewed client clock is clamped into a 24h/5m window.
- **Websocket bursts are coalesced, not discarded.** The 100ms per-channel
  throttle dropped whole batches; it now buffers and replays them, with a
  bounded buffer and a `droppedRows` counter in `getStatus()`.
- One `getFrogger` implementation instead of two identical copies. The console
  reporter is no longer registered as a user reporter, so `getReporters()`
  cannot leak it and `clearReporters()` cannot silently kill console output.
- The rate limiter's cleanup interval is cancelled on reset and unref'd.


## v0.1.26

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.25...v0.1.26)

### 🚀 Enhancements

- Metrics enhancements ([9af3a9e](https://github.com/zephkelly/nuxt-frogger/commit/9af3a9e))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.25

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.24...v0.1.25)

### 🚀 Enhancements

- Improved metrics integration and new observe metrics transport ([bf1a278](https://github.com/zephkelly/nuxt-frogger/commit/bf1a278))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.24

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.23...v0.1.24)

### 🩹 Fixes

- Frogger startup messaging with relay transport pattern ([ba9e398](https://github.com/zephkelly/nuxt-frogger/commit/ba9e398))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.23

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.22...v0.1.23)

### 🩹 Fixes

- Production crashing bug ([b30408e](https://github.com/zephkelly/nuxt-frogger/commit/b30408e))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.22

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.21...v0.1.22)

### 🩹 Fixes

- Scrub directive detection and queue rescrubbing ([b13de55](https://github.com/zephkelly/nuxt-frogger/commit/b13de55))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.21

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.20...v0.1.21)

### 🩹 Fixes

- Span emission, error capture deduping, scrub precedence ([62d56ec](https://github.com/zephkelly/nuxt-frogger/commit/62d56ec))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.20

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.19...v0.1.20)

### 🚀 Enhancements

- Add source to enqueueBatch ([8da9f07](https://github.com/zephkelly/nuxt-frogger/commit/8da9f07))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.19

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.18...v0.1.19)

### 🩹 Fixes

- Logger scrubbers mutating objects directly ([93d69e1](https://github.com/zephkelly/nuxt-frogger/commit/93d69e1))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.18

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.17...v0.1.18)

### 🚀 Enhancements

- Adjust addContext to upsert by default with optional override ([d99d586](https://github.com/zephkelly/nuxt-frogger/commit/d99d586))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.17

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.16...v0.1.17)

### 🚀 Enhancements

- Add top level console-silencing options ([b7fca3c](https://github.com/zephkelly/nuxt-frogger/commit/b7fca3c))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.16

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.15...v0.1.16)

### 🚀 Enhancements

- Unit and e2e testing helpers ([6a20429](https://github.com/zephkelly/nuxt-frogger/commit/6a20429))
- Foundational metrics collection pipeline ([1bcce7e](https://github.com/zephkelly/nuxt-frogger/commit/1bcce7e))

### 🩹 Fixes

- Harden log ingestion pipline at app start ([c35bb9a](https://github.com/zephkelly/nuxt-frogger/commit/c35bb9a))
- Individual logger scrub options being discarded ([828bb04](https://github.com/zephkelly/nuxt-frogger/commit/828bb04))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.15

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.14...v0.1.15)

### 🚀 Enhancements

- Rework transport layer to factory config pattern ([ede6fbf](https://github.com/zephkelly/nuxt-frogger/commit/ede6fbf))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.14

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.13...v0.1.14)

### 🚀 Enhancements

- Rebuild PII scruber with API builder and declerative rule sets ([f6c5957](https://github.com/zephkelly/nuxt-frogger/commit/f6c5957))
- Ambient span resolvers on loggers for tracing ([0613c11](https://github.com/zephkelly/nuxt-frogger/commit/0613c11))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.13

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.12...v0.1.13)

### 🚀 Enhancements

- Quick external transport configuration for observability ([916486a](https://github.com/zephkelly/nuxt-frogger/commit/916486a))

### 🩹 Fixes

- Test and type errors in app ready for new release ([7b2c8ce](https://github.com/zephkelly/nuxt-frogger/commit/7b2c8ce))
- Deployment workflow ([d21dffd](https://github.com/zephkelly/nuxt-frogger/commit/d21dffd))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.12

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.11...v0.1.12)

### 🏡 Chore

- Rework configuration to be quiet by default ([600585a](https://github.com/zephkelly/nuxt-frogger/commit/600585a))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.11

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.10...v0.1.11)

### 🩹 Fixes

- Runtime config imports and server log queue not referencing kv storage layer ([dc00546](https://github.com/zephkelly/nuxt-frogger/commit/dc00546))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.10

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.7...v0.1.10)

### 🚀 Enhancements

- Add regex rule cache to scrubber ([b3bad9d](https://github.com/zephkelly/nuxt-frogger/commit/b3bad9d))
- Add nitro side global error capture ([1a4159c](https://github.com/zephkelly/nuxt-frogger/commit/1a4159c))
- Log level parser utility ([1c900e5](https://github.com/zephkelly/nuxt-frogger/commit/1c900e5))
- UseFroggerWebSocket composable with method-chaining syntax ([6be80e3](https://github.com/zephkelly/nuxt-frogger/commit/6be80e3))

### 🩹 Fixes

- Single pass string operation on maskPhone in scrubber ([43df426](https://github.com/zephkelly/nuxt-frogger/commit/43df426))
- Websocket KV layer mutating stored object ([a6e3395](https://github.com/zephkelly/nuxt-frogger/commit/a6e3395))
- Log dir build-time capture and websocket KV store now async loads ([d68c7a9](https://github.com/zephkelly/nuxt-frogger/commit/d68c7a9))

### 🏡 Chore

- Use built-in baseURL param in  over URL construction ([d1a3958](https://github.com/zephkelly/nuxt-frogger/commit/d1a3958))
- Refactor websocket kv layer to use dep injection for storage ([fe87e26](https://github.com/zephkelly/nuxt-frogger/commit/fe87e26))
- Improve client useFrogger and websocket  ergonomics ([64af9f4](https://github.com/zephkelly/nuxt-frogger/commit/64af9f4))
- **release:** V0.1.8 ([b927a6d](https://github.com/zephkelly/nuxt-frogger/commit/b927a6d))
- Update websocket transport to use new log level parser ([f22a940](https://github.com/zephkelly/nuxt-frogger/commit/f22a940))
- Dependency inject storage and transport websocket layers ([9419f14](https://github.com/zephkelly/nuxt-frogger/commit/9419f14))
- **release:** V0.1.9 ([478e725](https://github.com/zephkelly/nuxt-frogger/commit/478e725))
- Update dependencies ([325552e](https://github.com/zephkelly/nuxt-frogger/commit/325552e))

### ✅ Tests

- Add test cases for log scrubber ([3e81bc9](https://github.com/zephkelly/nuxt-frogger/commit/3e81bc9))
- Add test file for websocket storage layer ([6831dd1](https://github.com/zephkelly/nuxt-frogger/commit/6831dd1))
- Add websocket kv layer test case with 80%+ coverage ([49b4849](https://github.com/zephkelly/nuxt-frogger/commit/49b4849))
- Parse url parameters test file ([ed66552](https://github.com/zephkelly/nuxt-frogger/commit/ed66552))
- Websocket log handler test file ([21719f3](https://github.com/zephkelly/nuxt-frogger/commit/21719f3))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>
- Ekelly <masterevank@gmail.com>

## v0.1.9

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.8...v0.1.9)

### 🚀 Enhancements

- Add nitro side global error capture ([1a4159c](https://github.com/zephkelly/nuxt-frogger/commit/1a4159c))
- Log level parser utility ([1c900e5](https://github.com/zephkelly/nuxt-frogger/commit/1c900e5))
- UseFroggerWebSocket composable with method-chaining syntax ([6be80e3](https://github.com/zephkelly/nuxt-frogger/commit/6be80e3))

### 🏡 Chore

- Update websocket transport to use new log level parser ([f22a940](https://github.com/zephkelly/nuxt-frogger/commit/f22a940))
- Dependency inject storage and transport websocket layers ([9419f14](https://github.com/zephkelly/nuxt-frogger/commit/9419f14))

### ✅ Tests

- Parse url parameters test file ([ed66552](https://github.com/zephkelly/nuxt-frogger/commit/ed66552))
- Websocket log handler test file ([21719f3](https://github.com/zephkelly/nuxt-frogger/commit/21719f3))

### ❤️ Contributors

- Ekelly <masterevank@gmail.com>

## v0.1.8

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.7...v0.1.8)

### 🚀 Enhancements

- Add regex rule cache to scrubber ([b3bad9d](https://github.com/zephkelly/nuxt-frogger/commit/b3bad9d))

### 🩹 Fixes

- Single pass string operation on maskPhone in scrubber ([43df426](https://github.com/zephkelly/nuxt-frogger/commit/43df426))
- Websocket KV layer mutating stored object ([a6e3395](https://github.com/zephkelly/nuxt-frogger/commit/a6e3395))

### 🏡 Chore

- **release:** V0.1.7 ([03c5426](https://github.com/zephkelly/nuxt-frogger/commit/03c5426))
- Use built-in baseURL param in  over URL construction ([d1a3958](https://github.com/zephkelly/nuxt-frogger/commit/d1a3958))
- Refactor websocket kv layer to use dep injection for storage ([fe87e26](https://github.com/zephkelly/nuxt-frogger/commit/fe87e26))
- Improve client useFrogger and websocket  ergonomics ([64af9f4](https://github.com/zephkelly/nuxt-frogger/commit/64af9f4))

### ✅ Tests

- Add test cases for log scrubber ([3e81bc9](https://github.com/zephkelly/nuxt-frogger/commit/3e81bc9))
- Add test file for websocket storage layer ([6831dd1](https://github.com/zephkelly/nuxt-frogger/commit/6831dd1))
- Add websocket kv layer test case with 80%+ coverage ([49b4849](https://github.com/zephkelly/nuxt-frogger/commit/49b4849))

### ❤️ Contributors

- Ekelly <masterevank@gmail.com>
- Zephkelly <masterevank@gmail.com>

## v0.1.7

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.6...v0.1.7)

### 🏡 Chore

- Fix missing useStorage import ([24890da](https://github.com/zephkelly/nuxt-frogger/commit/24890da))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.6

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.5...v0.1.6)

### 🚀 Enhancements

- Add justification section, expand getting started guide ([7a12e0a](https://github.com/zephkelly/nuxt-frogger/commit/7a12e0a))
- Add baseUrl option to module options and client logger options ([754aff5](https://github.com/zephkelly/nuxt-frogger/commit/754aff5))
- Add baseUrl option in module options, client logger, http transport ([88debe6](https://github.com/zephkelly/nuxt-frogger/commit/88debe6))

### 🩹 Fixes

- Incorrect import paths for http-transport and web-soc handler ([4cb6739](https://github.com/zephkelly/nuxt-frogger/commit/4cb6739))
- Broken useState imports in useFrogger and client log queue ([4263376](https://github.com/zephkelly/nuxt-frogger/commit/4263376))
- Update missing runtimeConfig imports in server log queue and getFrogger instances ([4eeda63](https://github.com/zephkelly/nuxt-frogger/commit/4eeda63))
- DefineNuxtPlugin is only available via #app import ([a8b3202](https://github.com/zephkelly/nuxt-frogger/commit/a8b3202))

### 📖 Documentation

- Update installation and configuration pages, add getting started page ([d18f0e8](https://github.com/zephkelly/nuxt-frogger/commit/d18f0e8))
- Update installation and configuration pages, add getting started page ([97cd24e](https://github.com/zephkelly/nuxt-frogger/commit/97cd24e))
- Update docs to include baseUrl option ([c33cc9b](https://github.com/zephkelly/nuxt-frogger/commit/c33cc9b))

### 🏡 Chore

- Add defineNitroPlugin imports and pass client frogger options through useFrogger composable ([19f9a77](https://github.com/zephkelly/nuxt-frogger/commit/19f9a77))
- Release v0.1.0 ([4efe49d](https://github.com/zephkelly/nuxt-frogger/commit/4efe49d))
- Update readme to include installation steps ([3387b78](https://github.com/zephkelly/nuxt-frogger/commit/3387b78))
- Fix import and log format errors in deduplication tests ([9ba6c7f](https://github.com/zephkelly/nuxt-frogger/commit/9ba6c7f))
- **release:** V0.1.1 ([ac518f6](https://github.com/zephkelly/nuxt-frogger/commit/ac518f6))
- **release:** V0.1.2 ([4fde4d2](https://github.com/zephkelly/nuxt-frogger/commit/4fde4d2))
- Update homepage in package.json and update readme install guide ([c0b3d55](https://github.com/zephkelly/nuxt-frogger/commit/c0b3d55))
- **release:** V0.1.3 ([b266103](https://github.com/zephkelly/nuxt-frogger/commit/b266103))
- Move all #app imports to use #imports ([be1795c](https://github.com/zephkelly/nuxt-frogger/commit/be1795c))
- **release:** V0.1.4 ([3a9c443](https://github.com/zephkelly/nuxt-frogger/commit/3a9c443))
- **release:** V0.1.5 ([908d349](https://github.com/zephkelly/nuxt-frogger/commit/908d349))
- Mostly complete main overview sections ([3e4a0d2](https://github.com/zephkelly/nuxt-frogger/commit/3e4a0d2))
- Mostly complete overview section of docs ([#87](https://github.com/zephkelly/nuxt-frogger/pull/87))

### ❤️ Contributors

- Evan Kelly <masterevank@gmail.com>
- Zephkelly <masterevank@gmail.com>

## v0.1.5

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.4...v0.1.5)

### 🏡 Chore

- Add defineNitroPlugin imports and pass client frogger options ([#82](https://github.com/zephkelly/nuxt-frogger/pull/82))

### ❤️ Contributors

- Evan Kelly <masterevank@gmail.com>

## v0.1.4

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.3...v0.1.4)

### 🩹 Fixes

- DefineNuxtPlugin is only available via #app import ([c70c55d](https://github.com/zephkelly/nuxt-frogger/commit/c70c55d))

### 🏡 Chore

- Move all #app imports to use #imports ([5a89044](https://github.com/zephkelly/nuxt-frogger/commit/5a89044))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.3

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- Update missing runtimeConfig imports in server log queue and getFrogger instances ([9f7a8f3](https://github.com/zephkelly/nuxt-frogger/commit/9f7a8f3))

### 🏡 Chore

- Update homepage in package.json and update readme install guide ([b3e69b0](https://github.com/zephkelly/nuxt-frogger/commit/b3e69b0))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.2

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.1...v0.1.2)

### 🩹 Fixes

- Broken useState imports in useFrogger and client log queue ([098e20b](https://github.com/zephkelly/nuxt-frogger/commit/098e20b))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.1

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.1.0...v0.1.1)

### 🩹 Fixes

- Incorrect import paths for http-transport and web-soc handler ([80e615d](https://github.com/zephkelly/nuxt-frogger/commit/80e615d))

### 🏡 Chore

- Update readme to include installation steps ([dc9994b](https://github.com/zephkelly/nuxt-frogger/commit/dc9994b))
- Fix import and log format errors in deduplication tests ([7d75c7d](https://github.com/zephkelly/nuxt-frogger/commit/7d75c7d))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v0.1.0

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.0.2...v0.1.0)

### 🚀 Features

- Runtime Config ([#11](https://github.com/zephkelly/nuxt-frogger/pull/11))
  - Moved all module configuration into runtime config.
  - All settings are now overridable in `nuxt.config.js` and through .env variables.

- Batch Settings ([#16](https://github.com/zephkelly/nuxt-frogger/pull/16)) ([#19](https://github.com/zephkelly/nuxt-frogger/pull/19))
  - Added support for batch settings via module options.
  - Separate client and server batch settings.

- Pluggable Reporters ([#32](https://github.com/zephkelly/nuxt-frogger/pull/32)) ([#34](https://github.com/zephkelly/nuxt-frogger/pull/34))
  - Add your own reporters to your logger instances by implementing the `IFroggerReporter` interface.
  - Built-in reporters include:
    - Console Reporter: Prints logs to console handling either node or browser environments.

- Transports 
  - On the client you have `Reporters`, on the server you have `Transports`.
  - Transports do something with your logs, or send them somewhere.
  - Built-in transports include:
    - Batch Transport - Moved from reporter to transporter. If enabled,
      all other transports become downstream transports of the batch transporter.
    - File Transport
    - HTTP Transport ([#38](https://github.com/zephkelly/nuxt-frogger/pull/38))
    - Websocket Transport ([#55](https://github.com/zephkelly/nuxt-frogger/pull/55))

- Rate Limiting ([#42](https://github.com/zephkelly/nuxt-frogger/pull/42))
  - In-built rate limiting for auto-generated logging endpoints.
  - Tracks request counts in 4 levels: `global`, per `app`, per `reporter`, and finally per `ip`
  - Uses nitro's useStorage allowing any driver to be used to store rate limit data (defaults to `memory`).
  - Configurable via module options

- Global Client Error Capture ([#46](https://github.com/zephkelly/nuxt-frogger/pull/46))
  - Automatically captures and logs unhandled client-side errors.
  - Configurable via module options.

- Log Scrubber ([#60](https://github.com/zephkelly/nuxt-frogger/pull/60))
  - Basic automatic PII scrubbing, redacting or removing sensitive fields from logs
  - Configurable via module options.

- Automatic Client-Server Trace Context Capture ([#65](https://github.com/zephkelly/nuxt-frogger/pull/65))
  - Using experimental `asyncContext` nitro API to capture trace context from headers in getFrogger() instances.
  - No longer required to pass in an 'Event' object to getFrogger().
  - Can be disabled via module options.

- Child Loggers & Reactive Context ([#69](https://github.com/zephkelly/nuxt-frogger/pull/69)) ([#73](https://github.com/zephkelly/nuxt-frogger/pull/73))
  - Child loggers can be created using `child()` and `reactiveChild()` methods.
    - `reactiveChild()` creates a reactive child logger that updates its context when the parent logger's context changes.

- `frogger.config.ts` File ([#74](https://github.com/zephkelly/nuxt-frogger/pull/74))
  - Added an optional `frogger.config.ts` file to the root of your Nuxt project to move configuration out of `nuxt.config.js`.

- Toggleable Client/Server Modes ([#78](https://github.com/zephkelly/nuxt-frogger/pull/78))
  - In some scenarios you may not want the server side in SPA or statically generated apps.
  - You can now toggle the client and server modes on and off via module options.

### 🐛 Bug Fixes

- Fixed client sending logs to server, even when serverModule is disabled ([commit 2ae1d0b](https://github.com/zephkelly/nuxt-frogger/commit/2ae1d0b618a59d044a606356aea187a9cfa84d52))

- Fixed hot-reload causing log folder to be placed in the wrong location ([commit b63fce9](https://github.com/zephkelly/nuxt-frogger/pull/46/commits/b63fce974635403731f065b72097c15aa42d0734))

## v0.0.2

[compare changes](https://github.com/zephkelly/nuxt-frogger/compare/v0.0.1...v0.0.2)

## v0.0.1