# Scrubbing & PII

Frogger can redact sensitive data from your logs **before they're stored**. It ships a set of
scrubbing **strategies** (redact, mask, hash, …) and reusable **field-name lists** as primitives,
and you compose them into rules with a fluent builder. Fields like passwords, emails, phone numbers,
and card numbers are matched by name and masked, redacted, or hashed.

::: warning Scrubbing is opt-in — and so is every rule
Scrubbing is **off by default**. Enabling it (`scrub: true`, a `scrub` object, or a
[preset](../configuration.md#presets)) turns the engine on but adds **zero rules** — nothing is
scrubbed until *you* declare a rule. This is deliberate: field-name matching is easy to over-apply
(a key like `name` holds `error.name` or a resource name far more often than a person's name), so
Frogger never guesses on your behalf.

In development Frogger prints the active rule count so an empty config is visible:

```
🐸 FROGGER Ready to log
🐸 FROGGER scrubbing enabled: 0 rules active
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
