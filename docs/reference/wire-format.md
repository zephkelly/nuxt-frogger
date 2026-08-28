# Wire format

Frogger is a **collection** package. It has no viewer, so the format it puts on
the wire *is* its public API — [nuxt-observe](https://github.com/zephkelly/nuxt-observe)
and any backend you point it at consume this and nothing else.

This page is the contract. It is versioned alongside `meta.schema`, and it says
which fields a reader may assume are present.

**Current version: `frogger.logs/1`, `frogger.metrics/1`.**

## Versioning

Every batch carries `meta.schema`:

```json
{ "meta": { "schema": "frogger.logs/1" } }
```

Branch on this, never on field presence. The version bumps only on a **field
removal or a semantic change**; additive fields do not bump it, so a reader
written against `/1` keeps working as fields are added.

A batch with no `meta.schema` predates 0.2.0.

## The log envelope

```json
{
  "logs": [ /* LoggerObject[] */ ],
  "spans": [ /* SpanObject[], optional */ ],
  "app": { "name": "shop", "version": "2.1.0" },
  "resource": {
    "service.name": "shop",
    "service.version": "2.1.0",
    "service.release": "2.1.0",
    "deployment.environment": "production",
    "service.instance.id": "0192f0c1-..."
  },
  "session": { "id": "0192f0...", "sampled": true },
  "user": "user-42",
  "meta": {
    "schema": "frogger.logs/1",
    "processed": true,
    "processChain": ["frogger-http-0192f..."],
    "source": "shop",
    "time": 1787920000000,
    "received": { "at": 1787920000123, "ip": "203.0.113.5" }
  }
}
```

`resource`, `session` and `user` ride the envelope once and are **denormalised
onto each row at ingest**, so a transport receiving a bare `LoggerObject[]`
still sees them.

## `LoggerObject`

| Field | Type | Always present | Stamped by | Safe to index | Scrubbed |
| --- | --- | --- | --- | --- | --- |
| `id` | `string` (uuidv7) | yes | emitter | yes | no |
| `time` | `number` (epoch ms) | yes | emitter | yes | no |
| `obsTime` | `number` (epoch ms) | after ingest | ingest | yes | no |
| `lvl` | `number` | yes | emitter | yes | no |
| `sev` | `number` | yes | emitter | yes | no |
| `type` | `string` | yes | emitter | yes | no |
| `kind` | `'event'` | only for `frogger.event()` | emitter | yes | no |
| `msg` | `string` | yes | emitter | no | only with `scrub.message` |
| `ctx` | `object` | yes | caller | no | **yes** |
| `env` | `'ssr' \| 'csr' \| 'client' \| 'server'` | yes | emitter | yes | no |
| `trace` | `{ traceId, spanId, parentSpanId?, flags? }` | yes | emitter | yes | no |
| `session` | `{ id, sampled }` | when known | emitter / ingest | yes | **never** |
| `user` | `string` | after `identify()` | emitter / ingest | yes | **never** |
| `route` | `string` (pattern) | when known | emitter / ingest | yes | **never** |
| `source` | `{ name, version }` | when `app` is set | ingest | yes | no |
| `resource` | `object` | after ingest | ingest | yes | no |

### Guarantees with zero per-app configuration

A backend can rely on every row having:

`id`, `time`, `lvl`, `sev`, `type`, `msg`, `env`, `trace.traceId`,
`trace.spanId`.

After a row has crossed an ingest route it additionally has `obsTime` and
`resource['deployment.environment']` (and `resource['service.name']` whenever
`app` was configured).

### `time` vs `obsTime`

`time` is what the **emitter claimed**. `obsTime` is what the **collector
observed**. This mirrors OTel's Timestamp / ObservedTimestamp split.

They differ when a client's clock is wrong, which is routine on VMs and on
phones after sleep. Ingest clamps a claimed `time` into `[now - 24h, now + 5m]`
so a badly skewed row cannot sort into the wrong place forever, but `obsTime`
is the value to trust when the two disagree.

### `lvl` vs `sev`

Two axes, pointing in **opposite directions**:

- `lvl` is Frogger's verbosity level. **Lower is more important** (`error` is
  0, `trace` is 5). This is what the logger's threshold gates on.
- `sev` is the OpenTelemetry SeverityNumber. **Higher is more serious**
  (`trace` 1, `debug` 5, `info` 9, `warn` 13, `error` 17, `fatal` 21).

Index on `sev`. Both are always finite and JSON-safe.

### Never-scrubbed fields

`session`, `user` and `route` are **top-level fields, not `ctx` keys, and the
scrubber never touches them**. This is a deliberate invariant, not an oversight:
they are the reader's index keys. Redacting them would break every join a
backend can perform while protecting nothing — `user` is a correlation id, not
a name, and `route` is a pattern, not a path.

`ctx` is the opposite: it is user-owned, arbitrarily shaped, and *is* scrubbed.

### Untrusted fields

`app`, `source`, `session`, `user` and `time` on an inbound batch are
**client-declared**. Anyone who can reach the ingest route can send them. A
reader must treat them as claims, not facts.

The server-authoritative facts are in `meta.received`:

- `meta.received.at` — when the collector accepted the batch.
- `meta.received.ip` — the peer address it came from.

## `SpanObject`

Carried in the same envelope under `spans`. A spans-only batch is valid: a span
can do work without logging inside it.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` (uuidv7) | Dedupe key |
| `traceId` / `spanId` | `string` | |
| `parentSpanId` | `string` | The span that created this one |
| `name` | `string` | |
| `kind` | `'internal' \| 'server' \| 'client'` | |
| `startTime` / `endTime` | `number` (epoch ms) | Both present; no subtraction needed |
| `status` | `{ code: 'unset' \| 'ok' \| 'error', message? }` | |
| `attributes` | `Record<string, string \| number \| boolean>` | Bounded at 64 keys, 1024 chars per value |
| `env` | as `LoggerObject.env` | |
| `resource` / `session` / `user` / `route` | | Denormalised at ingest |

Span status follows OTel's **total order**: once `error`, a later `ok` cannot
downgrade it.

## Span identity

Every logger owns **one** span id, stable for its lifetime.

- Every row a logger emits carries that same `trace.spanId`. "The logs inside
  this span" is one predicate.
- `child()`, `span()` and `startSpan()` mint a new span whose `parentSpanId`
  is the creating logger's span. The tree is deterministic and does not depend
  on how many rows the parent emitted first.

::: warning Changed in 0.2.0
Before 0.2.0, `spanId` was re-minted on **every log call** and `parentId` meant
"the row emitted immediately before this one". No two rows shared a span id,
and a span's parent edge depended on emission order. `parentId` is now
`parentSpanId` and means what its name says.
:::

## The metric envelope

```json
{
  "metrics": [ /* MetricObject[] */ ],
  "app": { "name": "shop", "version": "2.1.0" },
  "resource": { "...": "as above" },
  "context": { "ua": "...", "effectiveType": "4g", "viewport": { "w": 1440, "h": 900 } },
  "session": { "id": "0192f0...", "sampled": true },
  "user": "user-42",
  "meta": { "schema": "frogger.metrics/1", "time": 1787920000000, "received": { "at": 1787920000123 } }
}
```

`MetricObject` carries `id`, `time`, `name`, `kind`, `value`, `unit?`,
`labels?`, `attr?`, `env`, and the same denormalised `source` / `context` /
`session` / `user` / `resource` / `trace` fields.

### `labels` vs `attr`

The single most important distinction in the metric format:

- **`labels` are indexed.** Every distinct combination is a series. Bounded by
  source code, never by user data. Capped at 200 combinations per name, after
  which points keep their value and their labels become `{ overflow: true }`.
- **`attr` is not indexed.** Ids, urls, raw deltas, Web Vitals attribution
  detail. Free to be high-cardinality.

### Exemplars

`trace` on a metric point is an **exemplar: a pointer, not a foreign key**. The
referenced trace's logs may not exist — a sampled-out session still emits
metrics — so a reader must treat a missing trace as normal.

## Deduplication and ordering

Every record carries a **uuidv7 `id`**, minted where the record was constructed
and preserved unchanged across relay hops.

- Use it as the **dedupe key**. A batch retried after a lost response arrives
  with the same ids.
- It is **time-ordered**, so it also works as a sort key and as a stable
  tiebreaker for records sharing a `time`.

Do not use `trace.spanId` for either: it is shared by every row in a span, by
design.

## Loop detection

`meta.processChain` accumulates one entry per relay hop. A duplicate entry means
the batch has come back to a hop it already visited, and the ingest route
rejects it with `400 FROGGER_LOOP_DETECTED`.

`meta.processed` and the `x-frogger-processed` header mean only "this came
through a Frogger transport" — a normal relay, not a loop.

## Ingest limits

The `/api/_frogger/logs` route enforces:

| Limit | Value | On breach |
| --- | --- | --- |
| Request body | 1 MiB | `413 REQUEST_TOO_LARGE` |
| Logs per batch | 1000 | `400 FROGGER_BATCH_TOO_LARGE` |
| Message length | 32 KiB | Truncated with `…[truncated]` |
| `time` window | `[now - 24h, now + 5m]` | Clamped |

Malformed bodies return `400 FROGGER_BAD_BODY`; malformed records return
`400 FROGGER_BAD_LOG`.

## OTLP

`httpTransport({ shape: 'otlp-logs' })` emits an OTLP/HTTP
`ExportLogsServiceRequest` instead of the Frogger envelope, which the
OpenTelemetry Collector, Grafana Alloy, SigNoz, Datadog, Axiom, Better Stack and
ClickStack all accept without knowing what Frogger is.

The mapping is applied immediately before the POST, so retry, backoff, chunking
and drop behaviour are identical either way. `sev` becomes `severityNumber`
directly — that is what it exists for.
