---
outline: deep
---

# Logger API

Every Frogger logger — whether created with [`useFrogger()`](/getting-started#client-side-logging)
on the client, [`getFrogger()`](/getting-started#server-side-logging) on the server, or accessed
through the ambient [`frogger`](/getting-started#quick-logging-with-frogger-drop-in-for-console)
— implements the same `IFroggerLogger` contract. Your code reads the same on the front and back
end.

```ts
export interface IFroggerLogger {
    // Log levels
    error(msg: string, ctx?: Object): void
    fatal(msg: string, ctx?: Object): void
    warn(msg: string, ctx?: Object): void
    log(msg: string, ctx?: Object): void
    info(msg: string, ctx?: Object): void
    success(msg: string, ctx?: Object): void
    fail(msg: string, ctx?: Object): void
    ready(msg: string, ctx?: Object): void
    start(msg: string, ctx?: Object): void
    debug(msg: string, ctx?: Object): void
    trace(msg: string, ctx?: Object): void
    silent(msg: string, ctx?: Object): void
    verbose(msg: string, ctx?: Object): void
    logLevel(level: LogType, msg: string, ctx?: Object): void

    // Reporters
    addReporter(reporter: IFroggerReporter): void
    removeReporter(reporter: IFroggerReporter): void
    getReporters(): readonly IFroggerReporter[]
    clearReporters(): void

    // Context
    addContext(ctx: Object): void
    setContext(ctx: Object): void
    clearContext(): void

    // Children
    child(options: FroggerOptions): IFroggerLogger
    reactiveChild(options: FroggerOptions): IFroggerLogger

    // Spans
    span<T>(name: string, fn: () => T | Promise<T>): Promise<T>
    startSpan(name: string, options?: FroggerOptions): IFroggerLogger

    // Tracing & lifecycle
    getHeaders(customVendor?: string): Record<string, string>
    reset(): void
}
```

## Log methods

Each method takes a human-readable `msg` and an optional structured `ctx`. See
[Log Levels](/reference/log-levels) for the level each one maps to.

```ts
logger.info('user logged in', { userId: '123' })
logger.error('checkout failed', { orderId, error })
```

`logLevel(level, msg, ctx)` emits a log at a level chosen at runtime — see
[Log Levels](/reference/log-levels#dynamic-levels-loglevel).

## Context

| Method | Effect |
| --- | --- |
| `addContext(ctx)` | Merge `ctx` into the logger's context (uses `defu`) |
| `setContext(ctx)` | Replace the logger's context entirely |
| `clearContext()` | Remove all context |

Context is appended to **every** log this logger makes. See
[Getting Started → Adding Context](/getting-started#adding-context).

## Child loggers

| Method | Behaviour |
| --- | --- |
| `child(options)` | A child that **snapshots** the parent's context at creation |
| `reactiveChild(options)` | A child that **live-inherits** later parent context changes |

See [Getting Started → Child Loggers](/getting-started#child-loggers).

## Spans

| Method | Behaviour |
| --- | --- |
| `span(name, fn)` | Runs `fn` with a named child installed as the **active logger** — every ambient `frogger.*` call (and `getFrogger()`) made while `fn` runs nests under the span. Restored when `fn` settles; returns `fn`'s result |
| `startSpan(name, options?)` | Returns the same named child (with `ctx.span = name`) to hold and pass around manually, without changing the active logger |

On the server, spans are backed by `AsyncLocalStorage`, so concurrent requests never mix their
trees. In the browser they are best-effort: sequential `await` chains are always correct, but two
spans awaiting concurrently can observe each other. See
[Getting Started → Nested Spans](/getting-started#nested-spans).

## Reporters

A reporter receives every `LoggerObject` the logger emits. See
[Transports & HttpTransport → Reporters](/guides/transports#reporters-fan-out-from-a-logger).

```ts
export interface IFroggerReporter {
    log: (entry: LoggerObject) => void | Promise<void>
}
```

## Tracing & lifecycle

- `getHeaders(customVendor?)` — returns the W3C `traceparent` / `tracestate` headers for the
  logger's current trace and span. Pass them along with outgoing requests to continue the trace.
  See [Getting Started → Trace Context](/getting-started#trace-context).
- `reset()` — clears context and starts a fresh trace.

## Per-instance options

Both `useFrogger()` and `getFrogger()` accept `FroggerOptions`:

```ts
export interface FroggerOptions {
    context?: LogContext   // initial context merged into every log
    scrub?: ScrubberOptions | boolean  // override scrubbing for this logger
    consoleOutput?: boolean // mirror this logger's output to the console
}
```

```ts
const logger = useFrogger({
    context: { feature: 'checkout' },
    scrub: { maxDepth: 3 },
    consoleOutput: false,
})
```

`consoleOutput` overrides the [`consoleOutput` module option](/configuration#console-output) for this
logger only, in either direction: an explicit `true` restores the console for one logger even when
the module has silenced it app-wide. When omitted, the module option decides (default `true`).
Silencing the console never affects transport delivery: the logger still batches and ships.

Child loggers and spans inherit their parent's resolved options, so `logger.child({})` and
`logger.startSpan('checkout')` print exactly when their parent does, unless they override it
themselves.

## LoggerObject

The record Frogger builds for every log:

```ts
export interface LoggerObject {
    time: number                 // epoch ms
    lvl: number                  // numeric level
    type: LogType                // 'error' | 'warn' | 'info' | ...
    msg: string                  // the human-readable message
    ctx: LogContext              // your structured context
    tags?: string[]
    env: 'ssr' | 'csr' | 'client' | 'server'
    source?: { name: string; version: string }
    trace: TraceContext          // { traceId, spanId, parentId?, flags? }
}
```

`msg` should be a static, human-readable string; put dynamic data in `ctx`. See
[Getting Started → Log Anatomy](/getting-started#log-anatomy).
