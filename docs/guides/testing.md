# Testing your logging

Frogger ships first-party test helpers so you can assert **"my app logged X"** without
standing up a real file or HTTP sink. Everything is built on the [`memoryTransport()`](/guides/transports#memorytransport-capture-logs-for-tests),
which captures every log into an in-memory array a test can read back.

Two subpath entry points package the helpers:

- **`nuxt-frogger/testing`** — Vitest helpers (capture, filter, `expect` matcher).
- **`nuxt-frogger/playwright`** — Playwright fixtures (intercept client→server batches, tripwire on Frogger's own errors).

The tooling packages (`vitest`, `@nuxt/test-utils`, `@playwright/test`) are **optional peer
dependencies** — you only need the ones you actually use.

## The memory transport

Add a `memoryTransport({ name })` to your `transports`. The `name` is the key you'll read the
captures back with:

```ts
// frogger.config.ts (or your test-only Nuxt config)
import { defineFroggerOptions, memoryTransport } from '#frogger/config'

export default defineFroggerOptions({
    transports: [memoryTransport({ name: 'test' })],
})
```

Under the hood a named memory transport shares its array through a process-global registry, so the
transport Frogger builds from config and the `getCapturedLogs({ name })` helper you call in a test
see the exact same captures.

::: info Server-only, for now
Like `fileTransport()`, `memoryTransport()` is **server-side only** in this release — it captures
logs that reach the Nitro server queue (including client logs beamed back to `/api/_frogger/logs`).
`client: true` is ignored with a warning. To assert on client→server batches directly in an e2e
test, use the [Playwright capture fixture](#playwright-end-to-end) below.
:::

## Vitest: unit-level capture

For a plain unit test you can drive a `MemoryTransport` directly — no Nuxt runtime required:

```ts
import { describe, it, expect } from 'vitest'
import { MemoryTransport, filterLogs } from 'nuxt-frogger/testing'

it('captures what was logged', () => {
    const memory = new MemoryTransport()

    memory.log({
        time: Date.now(), lvl: 1, type: 'warn', msg: 'disk almost full',
        ctx: {}, env: 'server', trace: { traceId: 't', spanId: 's' },
    })

    expect(memory.getLogs()).toHaveLength(1)
    expect(filterLogs(memory.getLogs(), { level: 'warn' })).toHaveLength(1)
})
```

`filterLogs(logs, matcher)` is the shared predicate behind every helper. Every field is optional and
all present fields must match:

| Field | Matches |
| --- | --- |
| `level` | The log level, as a name (`'warn'`) or the numeric `lvl` |
| `type` | The exact consola `type` (`'info'`, `'success'`, …) |
| `msg` | A substring (string) or pattern (RegExp) of `msg` |
| `ctx` | A subset of `ctx` — every listed key must deep-equal the log's |
| `traceId` | The log's `trace.traceId` |

## Vitest: Nuxt-level capture

To assert on logs that flow through the real server queue, run a Nuxt test (`// @vitest-environment
nuxt`) with a `memoryTransport({ name })` configured, then read the captures with
`getCapturedLogs`:

```ts
// @vitest-environment nuxt
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import {
    memoryTransport,
    getCapturedLogs,
    clearCapturedLogs,
    flushFrogger,
    froggerTestRuntimeConfig,
    stubFroggerFetch,
} from 'nuxt-frogger/testing'

const { runtimeConfig } = vi.hoisted(() => ({ runtimeConfig: vi.fn() }))
mockNuxtImport('useRuntimeConfig', () => runtimeConfig)

beforeEach(() => {
    clearCapturedLogs('test')
    vi.stubGlobal('$fetch', stubFroggerFetch())
    runtimeConfig.mockReturnValue(froggerTestRuntimeConfig({
        frogger: { transports: [memoryTransport({ name: 'test' })] },
    }))
})

it('logs a warning when the disk is full', async () => {
    // ...drive the code that logs...

    await flushFrogger()

    expect(getCapturedLogs({ name: 'test', level: 'warn', msg: /disk/ })).toHaveLength(1)
})
```

::: warning `mockNuxtImport` must stay at the top level
`mockNuxtImport('useRuntimeConfig', …)` is a **compile-time macro** — it has to sit at the top level
of the test file. `froggerTestRuntimeConfig()` only supplies the *value* the mock returns (with test
defaults: batching off, scrub and websocket disabled); it does not — and can't — call the macro for
you.
:::

### Determinism: `batch: false` + `flushFrogger()`

By default Frogger **batches** on the server, sorting logs in a time window before flushing them
downstream. In a test that fights fake timers. Two knobs keep captures deterministic:

- **`batch: false`** (the default in `froggerTestRuntimeConfig()`) — logs reach the memory transport
  synchronously on enqueue, so there's no time window to wait out.
- **`await flushFrogger()`** — force-drains the server queue before you assert. Harmless with
  `batch: false`; necessary if you deliberately test with batching on.

## The `toHaveLogged` matcher

For readable assertions, opt into the `toHaveLogged` Vitest matcher. It takes the same matcher shape
as `filterLogs` and passes when **at least one** captured log matches:

```ts
import { beforeAll, expect, it } from 'vitest'
import { registerFroggerMatchers, getCapturedLogs } from 'nuxt-frogger/testing'

beforeAll(async () => {
    await registerFroggerMatchers()
})

it('warns the operator to redeploy', () => {
    expect(getCapturedLogs({ name: 'test' })).toHaveLogged({ level: 'warn', msg: /redeploy/ })

    // and its negation
    expect(getCapturedLogs({ name: 'test' })).not.toHaveLogged({ level: 'error' })
})
```

Registration is **opt-in** (a function call, not a side-effecting import) so importing the testing
helpers never silently mutates the global `expect`. Calling `registerFroggerMatchers()` also augments
the `vitest` types, so `toHaveLogged` is fully typed.

## Playwright: end-to-end

The Playwright entry point captures the **client→server** log batches your app POSTs during a real
browser flow. Because client and server logs share a `traceId`, you can assert trace continuity
across the boundary.

```ts
import { test, expect } from 'nuxt-frogger/playwright'

test('logs on save', async ({ page, froggerCapture }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Save' }).click()

    const log = await froggerCapture.expectLog({ msg: /saved/, level: 'info' })
    expect(log.trace.traceId).toBeTruthy()
})
```

`froggerCapture` intercepts POSTs to `/api/_frogger/logs`, collects each batch, and lets the request
continue so the app still works. It exposes:

| Method | Returns |
| --- | --- |
| `getLogs(matcher?)` | Every captured log (flattened across batches), optionally filtered |
| `getBatches()` | The raw `LoggerObjectBatch` bodies as received |
| `waitForLog(matcher, opts?)` | Resolves once a matching log is captured, rejects on timeout |
| `expectLog(matcher, opts?)` | Same as `waitForLog` — reads as an assertion |
| `clear()` | Drops all captured batches |

You can also build a capture without the fixture via `useFroggerCapture(page, { endpoint? })` — handy
if your ingest route is customized.

### Tripwire: fail on Frogger's own errors

*"Frogger must never be the reason my e2e fails."* The opt-in `failOnFroggerInternalErrors` fixture
fails a test if Frogger logs any internal-diagnostics line (prefixed `🐸 Frogger`) to the console.
Reference it in a test to arm it:

```ts
import { test } from 'nuxt-frogger/playwright'

test('flow is clean of Frogger internal errors', async ({ page, failOnFroggerInternalErrors }) => {
    await page.goto('/')
    // ...drive the flow; the test fails if Frogger logs anything internally...
})
```

The stable prefix is exported as `FROGGER_INTERNAL_PREFIX` if you'd rather match it yourself.

::: info Fixtures, not a running suite
This release ships the fixtures, docs, and example above — not a standing Playwright config or CI
suite. Wire `nuxt-frogger/playwright` into your own `playwright.config.ts` as you would any fixture
module.
:::
