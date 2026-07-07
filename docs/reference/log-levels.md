# Log Levels

Frogger uses [consola](https://github.com/unjs/consola) under the hood, so it shares consola's
numeric log levels. Every log carries a numeric `lvl` and a string `type`.

| Level (`lvl`) | Types (`type`) | Method(s) |
| --- | --- | --- |
| `0` | `fatal`, `error` | `logger.fatal()`, `logger.error()` |
| `1` | `warn` | `logger.warn()` |
| `2` | `log` | `logger.log()` |
| `3` | `info`, `success`, `fail`, `ready`, `start` | `logger.info()`, `logger.success()`, … |
| `4` | `debug` | `logger.debug()` |
| `5` | `trace` | `logger.trace()` |
| `-999` | `silent` | `logger.silent()` |
| `999` | `verbose` | `logger.verbose()` |

::: info
Frogger does not support consola's `box` level.
:::

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
