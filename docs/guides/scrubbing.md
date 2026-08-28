# Scrubbing & PII

Frogger can redact sensitive data from your logs **before they're stored**. It ships a set of
scrubbing **strategies** (redact, mask, hash, …) and reusable **field-name lists** as primitives,
and you compose them into rules with a fluent builder. Fields like passwords, emails, phone numbers,
and card numbers are matched by name and masked, redacted, or hashed.

::: warning A bare `scrub: true` adds ZERO rules
Scrubbing is off by default. Setting `scrub: true` or passing a `scrub` object turns the
engine on but adds **no rules** — nothing is scrubbed until *you* declare one. This is
deliberate: field-name matching is easy to over-apply (a key like `name` holds `error.name`
or a resource name far more often than a person's name), so Frogger never guesses on your
behalf.

The `standard` and `full` [presets](../configuration.md#presets) are the exception: they
seed [`RECOMMENDED_RULES`](#recommended-bundle), because that is what they promise.

The build warns unconditionally when a scrubber resolves to zero rules, so believing
redaction is on when it is not is no longer possible:

```
🐸 FROGGER WARN Scrubbing is enabled but no rules are configured, so nothing is redacted.
```

In development Frogger also prints the active rule count:

```
🐸 FROGGER Ready to log
🐸 FROGGER scrubbing enabled: 7 rules active
```
:::

::: info Scrubbing runs on `ctx`, on the stored record
The scrubber processes the `ctx` object of each log before it's written to disk or broadcast (it does
**not** touch `msg`, `source`, `tags`, or `trace`). Console output may still show the original values,
but what lands in `logs/*.log` is scrubbed. Prefer structured context (`logger.error('login failed',
{ email })`) over interpolating secrets into the message string — only `ctx` can be scrubbed by field
name.
:::

## Quick start

Build a rule set with `defineScrub()`. Each method opts one strategy into one or more fields; field
arguments can be literal names, a RegExp, or one of the provided [field-name lists](#field-name-lists).

```ts
// frogger.config.ts
import { defineFroggerOptions, defineScrub, fields } from '#frogger/config'

export default defineFroggerOptions({
  scrub: defineScrub()
    .redact(fields.passwords, 'apiSecret')   // → [REDACTED]
    .maskEmail(fields.emails)                // → j***@example.com
    .maskPhone(fields.phones)                // → 1********0
    .keepEnds(fields.names, /customer.*name/i) // → J******n
    .maskCard('creditCard')                  // → **** **** **** 1111
    .build(),
})
```

With this config, given:

```ts
logger.info('user profile', {
  email: 'jane.doe@example.com',
  apiSecret: 'hunter2',
  creditCard: '4111 1111 1111 1111',
  firstName: 'Jane',
  name: 'invoice-service',   // NOT a person — left untouched
})
```

...the stored `ctx` is:

```json
{
  "email": "j***@example.com",
  "apiSecret": "[REDACTED]",
  "creditCard": "**** **** **** 1111",
  "firstName": "J**e",
  "name": "invoice-service"
}
```

Matching is **case-insensitive** by field name, and nested objects are scrubbed recursively — with no
depth limit unless you set `maxDepth`.

## Strategies

Each builder method applies one strategy. All strategies are also available as `SCRUB_STRATEGY`
tokens for raw rules.

| Builder method | Strategy | Result |
| --- | --- | --- |
| `.redact(...)` | `redact` | `[REDACTED]` (numbers → `0`; booleans are left as-is under `preserveTypes`) |
| `.maskAll(...)` | `mask_all` | every character → `*` (length preserved) |
| `.keepFirst(...)` | `keep_first` | keep the first character, mask the rest |
| `.keepLast(...)` | `keep_last` | mask all but the last character |
| `.keepEnds(...)` | `keep_ends` | keep the first and last character, mask the middle (length-preserving) |
| `.hash(...)` | `hash` | a stable, non-reversible `[HASH:…]` |
| `.maskEmail(...)` | `mask_email` | `j***@example.com` |
| `.maskPhone(...)` | `mask_phone` | keep first & last digit, mask the rest |
| `.maskCard(...)` | `mask_card` | keep the last 4 digits, mask the rest |

::: tip `keepEnds` preserves length
`keepEnds` masks the middle without collapsing length, so `"FetchError"` becomes `"F********r"` —
not a fixed-width `"F*****r"`. That earlier fixed-width behaviour is why a stray `name` key could look
mangled; opting into scrubbing is now explicit and the mask reflects the real length.
:::

## Field-name lists

Import ready-made lists and spread them into any strategy. They're **provided, never auto-applied**.
Access them as `fields.*` in the builder, or import the constants directly.

| Builder accessor | Constant | Covers |
| --- | --- | --- |
| `fields.passwords` | `PASSWORD_FIELDS` | `password`, `secret`, `apiKey`, `token`, `accessToken`, `refreshToken`, … |
| `fields.emails` | `EMAIL_FIELDS` | `email`, `userEmail`, `emailAddress`, `/.*email.*/i` |
| `fields.phones` | `PHONE_FIELDS` | `phone`, `phoneNumber`, `mobile`, `cell`, `/.*phone.*/i` |
| `fields.names` | `NAME_FIELDS` | `firstName`, `lastName`, `fullName`, `username`, `userId` |
| `fields.financial` | `FINANCIAL_FIELDS` | `ssn`, `socialSecurity`, `creditCard`, `cardNumber`, `accountNumber` |
| `fields.addresses` | `ADDRESS_FIELDS` | `address`, `street`, `city`, `zipCode`, `postalCode` |

::: details Full contents of every field list
Plain strings are matched **case-insensitively by exact key name**; RegExp entries are tested against
the key. A list never implies a strategy — you choose what happens to matched fields.

```ts
PASSWORD_FIELDS = [
  'password', 'passwd', 'pwd', 'secret',
  'apiKey', 'api_key', 'apikey',
  'token', 'accessToken', 'refreshToken',
  'privateKey', 'clientSecret',
]

EMAIL_FIELDS = [
  'email', 'userEmail', 'emailAddress', 'e_mail',
  /.*email.*/i,          // catches myEmailAddress, contact_email, ...
]

PHONE_FIELDS = [
  'phone', 'phoneNumber', 'mobile', 'cell',
  /.*phone.*/i,          // catches homePhone, phone_number, ...
]

NAME_FIELDS = [
  'firstName', 'lastName', 'fullName', 'username', 'userId',
  // bare 'name' deliberately excluded — see warning above
]

FINANCIAL_FIELDS = [
  'ssn', 'socialSecurity',
  'creditCard', 'cardNumber', 'accountNumber',
]

ADDRESS_FIELDS = [
  'address', 'street', 'city', 'zipCode', 'postalCode',
]
```
:::

::: warning `name` is deliberately excluded
`NAME_FIELDS` does **not** include the bare key `name` — it's too overloaded in telemetry
(`error.name`, browser/vendor name, resource name). Note that a positionally-logged error
(`logger.error('failed', err)`) is serialized to `ctx.error.{name, message, stack}`, so `error.name`
is only ever masked if you opt a `name` rule in yourself. Add `'name'` explicitly if you truly need it.
:::

## Recommended bundle

For sensible baseline coverage without hand-writing every rule, opt into `RECOMMENDED_RULES`:

```ts
import { defineFroggerOptions, defineScrub, RECOMMENDED_RULES } from '#frogger/config'

export default defineFroggerOptions({
  scrub: defineScrub()
    .use(...RECOMMENDED_RULES)   // passwords, emails, phones, cards, names, addresses
    .redact('myAppSecret')       // plus your own
    .build(),
})
```

`RECOMMENDED_RULES` is a plain `ScrubRule[]`, so it also works in a raw rules array:
`scrub: { rules: [...RECOMMENDED_RULES] }`.

::: details What RECOMMENDED_RULES applies, rule by rule
Seven rules, highest priority first. Each row lists the strategy, the exact fields it targets, and
what a matched value becomes.

| # | Priority | Strategy | Fields | Result |
| --- | --- | --- | --- | --- |
| 1 | 100 | `redact` | all of `PASSWORD_FIELDS` (`password`, `passwd`, `pwd`, `secret`, `apiKey`, `api_key`, `apikey`, `token`, `accessToken`, `refreshToken`, `privateKey`, `clientSecret`) | `[REDACTED]` (numbers → `0`, booleans untouched) |
| 2 | 95 | `hash` | `ssn`, `socialSecurity` | stable `[HASH:1a2b3c]` — same input, same hash |
| 3 | 95 | `mask_card` | `creditCard`, `cardNumber`, `accountNumber` | `**** **** **** 1111` (keeps last 4 digits) |
| 4 | 90 | `mask_email` | all of `EMAIL_FIELDS` (`email`, `userEmail`, `emailAddress`, `e_mail`, `/.*email.*/i`) | `j***@example.com` |
| 5 | 90 | `mask_phone` | all of `PHONE_FIELDS` (`phone`, `phoneNumber`, `mobile`, `cell`, `/.*phone.*/i`) | `1********0` (keeps first & last digit) |
| 6 | 80 | `keep_ends` | all of `NAME_FIELDS` (`firstName`, `lastName`, `fullName`, `username`, `userId`) | `J******n` (keeps first & last character) |
| 7 | 70 | `keep_ends` | all of `ADDRESS_FIELDS` (`address`, `street`, `city`, `zipCode`, `postalCode`) | `1********t` |

Not covered — opt in yourself if you need them:
- the bare key `name` (too overloaded in telemetry; add `.keepEnds('name')` explicitly)
- `dateOfBirth` / `dob`, IP addresses, and any app-specific identifiers
:::

## Configuration

Pass builder-level options to `defineScrub()`, or set them via chained methods:

```ts
export interface ScrubberOptions {
  maxDepth?: number       // recursion bound for nested objects — omit for NO limit (default)
  deepScrub?: boolean     // recurse into nested objects at all — default true
  preserveTypes?: boolean // keep original types when masking (number → 0, boolean untouched) — default true
  rules?: ScrubRule[]     // the rules to apply — empty by default
}
```

::: info No depth limit by default
`maxDepth` defaults to `undefined`, which means **unlimited** — nested `ctx` objects are scrubbed all
the way down. Recursion is cycle-safe (circular references are detected and skipped), so a limit is
only needed if you log pathologically deep structures and want to cap the work. Set a number
(e.g. `maxDepth: 6`) to bound it.
:::

```ts
defineScrub({ maxDepth: 6 })
  .deepScrub(true)
  .redact(fields.passwords)
  .build()
```

Scrubbing is configured with the `scrub` option (module options or `frogger.config.ts`), or per-logger
via `useFrogger({ scrub })` / `getFrogger({ scrub })`.

Per-logger, `scrub` overrides the module config for that logger:

- `scrub: false` turns scrubbing off for that logger, even when module scrubbing is on.
- A `ScrubberOptions` object **replaces** the module rules entirely — module rules do not apply on
  top. To keep them, compose explicitly: `defineScrub().use(...RECOMMENDED_RULES).redact('myField').build()`.
- `true` or unset inherits the module config.

Child loggers (`child()`, `startSpan()`, `span()`) inherit the parent's effective `scrub` unless the
child options say otherwise — a child's `scrub` object likewise replaces the parent's rather than
merging with it.

```ts
import { defineScrub } from '#frogger/config'

// Module scrubbing stays on for everything else; this logger sees raw values.
const audit = useFrogger({ scrub: false })

// This logger applies ONLY the apiKey rule — module rules are replaced.
const jobs = getFrogger(event, {
  scrub: defineScrub().redact('apiKey').build(),
})
```

::: tip Turn it off
Set `scrub: false` to disable the engine entirely (e.g. to override a preset). An enabled engine with
no rules is already a no-op, so this is only needed to silence the dev notice.
:::

## Custom rules

You don't have to use the builder — a raw rule pairs a **strategy** with **field patterns** (strings
or RegExp) and a **priority** (when several rules match a field, the highest `priority` wins):

```ts
export interface ScrubRule {
  action: ScrubAction          // a SCRUB_STRATEGY token
  fieldPatterns: (string | RegExp)[]
  priority: number
  description?: string
}
```

```ts
import { defineFroggerOptions, SCRUB_STRATEGY } from '#frogger/config'

export default defineFroggerOptions({
  scrub: {
    rules: [
      { action: SCRUB_STRATEGY.REDACT, fieldPatterns: ['authToken', /.*secret.*/i], priority: 100 },
      { action: SCRUB_STRATEGY.KEEP_ENDS, fieldPatterns: ['internalUserRef'], priority: 80 },
    ],
  },
})
```

The builder's `.rule({ action, fields, priority, description })` method is the same escape hatch inside
a fluent chain.

::: info RegExp patterns are safe to serialize
Rules cross into Nuxt runtime config (and to the client) as JSON. Frogger compiles any RegExp field
pattern to a serialisable `{ source, flags }` form and reconstructs it at runtime, so `/.*email.*/i`
works identically on the server and in client-beamed logs.
:::

## What is never scrubbed

Three top-level fields on every log row are **exempt from scrubbing by design**:

- `session` — the browser session id
- `user` — the acting user's correlation id, set by `frogger.identify()`
- `route` — the matched route pattern

These are the reader's **index keys**. Redacting them would break every join a
backend can perform while protecting nothing: `user` is a correlation id rather
than a name, and `route` is a pattern rather than a path.

`ctx` is the opposite — user-owned, arbitrarily shaped, and always scrubbed.
Anything genuinely sensitive belongs there.

## Container types

The scrubber walks **`Map`, `Set` and `Headers`** as well as plain objects and
arrays, converting them on the copy so their contents are reachable by your
rules.

Other class instances are left alone deliberately: walking an arbitrary class is
how a scrubber ends up serialising a database connection into a log row.

::: info Fixed in 0.2.0
`Object.entries()` returns `[]` for `Map`, `Set` and `Headers`, so all three
used to pass through **by reference, unredacted**. That was the mechanism behind
error reports shipping `Cookie` and `Authorization` headers verbatim.
:::

## Value patterns

Key-based rules cannot catch a token pasted into a `note` field or an email
inside a message. Value patterns match on what a string **looks like**:

```ts
scrub: {
    rules: [...],
    values: true,      // email, Bearer token, JWT, Luhn-valid card number
    message: true,     // also scan `msg`, not just `ctx`
}
```

Both are **off by default**: they run regexes over every string in every log, so
the zero-config hot path stays free. Measure before enabling them on a hot path.

Bring your own set if the defaults do not fit:

```ts
values: [
    { name: 'ticket', pattern: /TICKET-\d+/g, replacement: '[TICKET]' },
]
```

::: tip Why the card pattern checks Luhn
A bare "13–19 digits" pattern also swallows order ids and timestamps, redacting
real data that was never sensitive. The default card pattern runs a Luhn check
before replacing.
:::

## Metrics

Metric `labels` and `attr` are scrubbed with the **same ruleset**, at the server
metrics queue — the one hop every server-recorded point crosses.

Three fields are carved out and never scrubbed, for the same reason as their log
equivalents: `name`, `user` and `session`.

::: warning Client-direct metric transports bypass this
A `client: true` metric transport POSTs straight from the browser and does not
cross the server queue, so its points are **not** scrubbed. If you fan metrics
out directly from the browser, do not put anything sensitive in `labels` or
`attr` — which is advice the cardinality model already gives you.
:::

## The `hash` strategy pseudonymises, it does not secure

`SCRUB_STRATEGY.HASH` produces a stable token, so the same value still
correlates across rows. That is the point of choosing it over `REDACT`.

It is **not** a security primitive: a hashed value drawn from a known input
space can be enumerated. For genuinely sensitive fields, use `REDACT`.

Set `NUXT_FROGGER_SCRUB_SALT` so tokens are not comparable across unrelated
deployments.
