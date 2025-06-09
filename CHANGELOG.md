# Changelog

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