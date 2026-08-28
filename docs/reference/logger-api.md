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
    addContext(ctx: Object, options?: { overwrite?: boolean }): void
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
| `addContext(ctx, options?)` | Deep-merge `ctx` into the logger's context |
| `setContext(ctx)` | Replace the logger's context entirely |
| `clearContext()` | Remove all context |

Context is appended to **every** log this logger makes. See
[Getting Started → Adding Context](/getting-started#adding-context).

### `addContext` merge precedence

`addContext` deep-merges the incoming context in. On a **key conflict**, the
incoming value wins by default (last-write-wins, the same convention as
pino/winston/bunyan/OpenTelemetry), so re-stamping a key updates it rather than
freezing on its first value:

```ts
logger.addContext({ route: '/login' })
logger.addContext({ route: '/dashboard' })
// context.route === '/dashboard'
```

Pass `{ overwrite: false }` to keep existing values and only fill in keys that
aren't already set ("set a default if absent"):

```ts
logger.addContext({ tenant: 'acme' })
logger.addContext({ tenant: 'other', region: 'eu' }, { overwrite: false })
// context === { tenant: 'acme', region: 'eu' }
```

Either way, nested objects are deep-merged; `overwrite` only decides the winner
on a leaf-key conflict.

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
    id: string                   // uuidv7 — dedupe and sort key
    time: number                 // epoch ms, as the emitter claimed
    obsTime?: number             // epoch ms, as the collector observed
    lvl: number                  // frogger level — LOWER is more important
    sev: number                  // OTel SeverityNumber — HIGHER is more serious
    type: LogType                // 'error' | 'warn' | 'info' | ...
    kind?: 'event'               // set by frogger.event()
    msg: string                  // the human-readable message
    ctx: LogContext              // your structured context (scrubbed)
    env: 'ssr' | 'csr' | 'client' | 'server'
    session?: { id: string; sampled: boolean }   // never scrubbed
    user?: string                                // never scrubbed
    route?: string                               // never scrubbed, always a pattern
    source?: { name: string; version: string }
    resource?: Record<string, string>            // denormalised at ingest
    trace: TraceContext          // { traceId, spanId, parentSpanId?, flags? }
}
```

The full reader contract — which fields are always present, who stamps each
one, and what is safe to index — is in the
[wire format reference](/reference/wire-format).

`msg` should be a static, human-readable string; put dynamic data in `ctx`. See
[Getting Started → Log Anatomy](/getting-started#log-anatomy).
