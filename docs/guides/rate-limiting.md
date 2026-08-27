# Rate Limiting

Frogger can rate-limit the log ingest endpoint (`/api/_frogger/logs`), protecting
your server from log floods — whether from a runaway loop in your own code or a targeted abuse
attempt. It's **opt-in** — off by default. Enable it with `rateLimit: true` (sensible defaults),
or pull it in via a preset:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  frogger: { rateLimit: true }        // or preset: 'standard' / 'full'
})
```

See [Presets](../configuration.md#presets) for what each preset bundles.

::: info Where it applies
Rate limiting guards the **server ingest endpoint** that client logs are beamed to. It does not
limit how often you can call `logger.info()` in your own code — only how many batches the server
will accept from a given source.

When [metrics](/guides/metrics) are enabled, the metrics ingest endpoint
(`/api/_frogger/metrics`) checks the same budget, so log and metric batches
from one IP share a window.
:::

## The four tiers

Once enabled, every incoming batch is checked against four sliding-window tiers. The **most
restrictive** matching tier wins.

| Tier | Limits requests from… | Default limit | Default window |
| --- | --- | --- | --- |
| `perIp` | a single IP address | 100 | 60s |
| `perReporter` | a single reporter/transport id | 50 | 60s |
| `perApp` | a single app (`app.name`) | 30 | 60s |
| `global` | everyone, combined | 10000 | 60s |

## Escalating blocks

Going over a limit returns a `429` and a `Retry-After`. But a source that **keeps** violating
gets escalating timeouts, and eventually a temporary ban — so persistent offenders are pushed
away rather than allowed to retry forever.

- After `violationsBeforeBlock` violations (default `3`), blocks kick in.
- Each subsequent block escalates through `timeouts` (default `[60, 300, 1800]` seconds).
- Once timeouts are exhausted, a `finalBanHours` ban applies (default `12` hours).
- The escalation counter resets after `escalationResetHours` of good behaviour (default `24`).

## The 429 response

When a batch is rejected the server responds with `429 Too Many Requests` (or `IP Blocked`) and
these headers:

```http
x-rate-limit-limit: 100
x-rate-limit-remaining: 0
x-rate-limit-reset: 1700000060
x-rate-limit-retry-after: 42
x-frogger-rate-limit-tier: ip
```

...and a JSON body:

```json
{
    "error": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for ip. Please wait 42 seconds before retrying.",
    "retryAfter": 42,
    "limit": 100,
    "current": 101,
    "resetTime": 1700000060
}
```

::: tip The client handles 429 for you
The client log queue is **429-aware** — when the server pushes back, it backs off with an
increasing multiplier and retries automatically (respecting `Retry-After`). You don't need to
write any retry logic for normal client logging.
:::

## Configuration

Tune the tiers, windows, and blocking under the `rateLimit` option:

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
    rateLimit: {
        limits:  { global: 10000, perIp: 100, perReporter: 50, perApp: 30 },
        windows: { global: 60, perIp: 60, perReporter: 60, perApp: 60 }, // seconds
        blocking: {
            enabled: true,
            violationsBeforeBlock: 3,
            timeouts: [60, 300, 1800],   // escalating block durations (seconds)
            finalBanHours: 12,
            escalationResetHours: 24,
        },
    },
})
```

::: tip Turn it off
Since rate limiting is opt-in, simply leave `rateLimit` unset (or set it to `false`) to keep it
disabled entirely.
:::

## Storage

Rate-limit counters and violation records are kept in Nitro's KV storage so they survive across
requests (and, with a persistent driver, across instances). By default it uses the in-memory
store; point it at a shared driver (e.g. Redis) for multi-instance deployments:

```ts
export default defineFroggerOptions({
    rateLimit: {
        storage: {
            driver: 'redis',
            options: { /* unstorage driver options */ },
        },
    },
})
```

See the [Configuration](/configuration) page for the full `rateLimit` reference.
