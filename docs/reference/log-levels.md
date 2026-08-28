# Log Levels

Frogger uses [consola](https://github.com/unjs/consola) under the hood. Every log
carries **two** numbers, pointing in opposite directions.

## `lvl` — verbosity

**Lower is more important.** This is what the threshold gates on: `level: 'info'`
admits everything with `lvl <= 3`.

| Level (`lvl`) | Types (`type`) | Method(s) |
| --- | --- | --- |
| `-1` | `silent` | `logger.silent()` |
| `0` | `fatal`, `error` | `logger.fatal()`, `logger.error()` |
| `1` | `warn` | `logger.warn()` |
| `2` | `log` | `logger.log()` |
| `3` | `info`, `success`, `fail`, `ready`, `start` | `logger.info()`, `logger.success()`, … |
| `4` | `debug` | `logger.debug()` |
| `5` | `trace`, `verbose` | `logger.trace()`, `logger.verbose()` |

## `sev` — OpenTelemetry SeverityNumber

**Higher is more serious.** Derived from `type`, and the axis a backend should
index on.

| `sev` | Types |
| --- | --- |
| `1` | `trace`, `verbose` |
| `5` | `debug` |
| `9` | `log`, `info`, `success`, `ready`, `start` |
| `13` | `warn` |
| `17` | `fail`, `error` |
| `21` | `fatal` |

::: warning Changed in 0.2.0
`verbose` was `Infinity` and `silent` was `-Infinity`, copied straight off
consola. Both `JSON.stringify` to **`null`**, so those rows reached every
transport with a null level — and `verbose()` could not fire at any finite
threshold at all. Every level is now finite and JSON-safe. See the
[migration notes](/migration/0.2#lvl-values-changed-for-verbose-and-silent).
:::

::: info
Frogger does not support consola's `box` level.
:::

## Setting the threshold

`frogger.debug()` and `frogger.trace()` are **dropped by default**: the
threshold is `info`. Raise it with the `level` option.

```ts
export default defineFroggerOptions({
    level: 'debug',                              // both runtimes
    // level: { server: 'debug', client: 'info' }, // or per runtime
})
```

A per-logger option still wins:

```ts
const logger = useFrogger({ level: 'trace' })
```

::: tip Not the same as `logLevel`
`level` governs **your application logs**. [`logLevel`](/configuration) governs
**Frogger's own internal diagnostics** — transport state, caught errors in its
machinery — and is silent in production by default.
:::

## Per-destination thresholds

Each transport takes its own `minLevel`, so "warn and above to the remote sink,
everything to the local file" is one word of config:

```ts
transports: [
    fileTransport(),
    httpTransport({ url: '...', minLevel: 'warn' }),
]
```

The logger's `level` decides what a record even is; each destination's
`minLevel` decides what it wants.

Every method has the same signature — a human-readable message, then optional structured context:

```ts
logger.error('payment declined', { orderId, code })
logger.success('order shipped', { orderId })
logger.debug('cache miss', { key })
```

## Dynamic levels — `logLevel()`

When the level isn't known until runtime, use `logLevel(type, msg, ctx)` with the `type` string:

```ts
logger.logLevel('error', 'this is an error at level 0')
logger.logLevel('success', 'this is a success at level 3', { orderId })
```

It also accepts a reactive ref for the level, which is handy when the severity is data-driven:

```ts
const level = ref<'info' | 'warn' | 'error'>('info')

logger.logLevel(level, 'status update')
level.value = 'error'
logger.logLevel(level, 'status escalated') // now logged at level 0
```

See the [Logger API reference](/reference/logger-api) for the full contract.
