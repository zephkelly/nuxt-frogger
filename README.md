# 🐸 Frogger

### The zero-setup logger for Nuxt

Log and trace from anywhere in your Nuxt applications. Server to client, client to server, to external services and back again. Install Frogger - add it as a module, and it just works. Automatically batches and sends logs to the server. No matter where you make a log, you'll find it in the same place.

A bare install logs to the **console** only. Add persistent destinations declaratively with the transport factories — rotated JSON-lines files with `fileTransport()`, any HTTP ingest with `httpTransport()`, or a [nuxt-observe](https://github.com/zephkelly/nuxt-observe) deployment with `observeTransport()`:

```ts
// frogger.config.ts
import { defineFroggerOptions, fileTransport, observeTransport } from '#frogger/config';

export default defineFroggerOptions({
    transports: [
        fileTransport(),                                          // logs/ on disk
        observeTransport({ url: 'https://observe.app.com', key }) // forward to observe
    ],
});
```

## Installation

### Automatic Installation

To install and register the latest version of Frogger, navigate to your Nuxt project and run the following command:

**pnpm:**
```sh
pnpm dlx nuxi@latest module add nuxt-frogger
```

**npm:**
```sh
npx nuxi@latest module add nuxt-frogger
```

### Manual Installation

Does the command above not work? You can install Frogger and register it manually:

**pnpm:**
```sh
pnpm add nuxt-frogger
```

**npm:**
```sh
npm install nuxt-frogger
```

### Register the Module

Add `'nuxt-frogger'` to `modules` in your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ]
})
```

## Migrating to 0.2.x (breaking)

- **File logging is no longer on by default.** A bare install logs to the console only. Add `fileTransport()` to `transports` to restore the previous rotated-file behaviour.
- **The top-level `file` module option was removed.** Move its settings into `fileTransport({ ... })`. The resolver warns if a legacy `file` key is still present.
- **`public.endpoint` now accepts `false`** to disable the browser POST to your app's own ingest route (the server route stays registered) — useful when the client fans out directly to an external sink.
- **Plain `{ url, apiKey }` transport objects still work** (an untagged entry is treated as `httpTransport(...)`), so existing declarative transports need no changes.
- **`HttpTransport` retry semantics were fixed.** Send failures used to be silently swallowed; they now retry (429/5xx/network) with exponential backoff and drop deterministically on a 4xx. If you depended on the old silent-drop behaviour, note that failing destinations will now be retried.