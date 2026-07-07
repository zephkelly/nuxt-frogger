# Scrubbing & PII

Frogger can redact sensitive data from your logs **before they're stored**. Fields like
passwords, emails, phone numbers, and card numbers are matched by a set of built-in rules and
masked, redacted, or hashed.

::: warning Scrubbing is opt-in
Scrubbing is **off by default**. Enable it with `scrub: true` (sensible defaults) — or pick it
up via a [preset](../configuration.md#presets).

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  frogger: { scrub: true }            // or preset: 'standard' / 'full'
})
```
:::

::: info Scrubbing runs on the stored record
The scrubber processes the `ctx` (and other fields) of each log before it's written to disk or
broadcast. Console output may still show the original values, but what lands in
`logs/*.log` is scrubbed.
:::

## What's scrubbed by default

| Action | Matches (field names) | Result |
| --- | --- | --- |
| `redact_full` | `password`, `passwd`, `pwd`, `secret`, `token`, `key`, `apikey`, `api_key` | `[REDACTED]` |
| `hash_value` | `ssn`, `socialSecurity`, `creditCard`, `cardNumber`, `accountNumber` | a stable hash |
| `mask_email` | `email`, `userEmail`, anything matching `/.*email.*/i` | `j***@example.com` |
| `mask_phone` | `phone`, `phoneNumber`, `mobile`, `cell`, `/.*phone.*/i` | keeps first & last digit, masks the rest |
| `mask_partial` | `name`, `firstName`, `lastName`, `fullName`, `username`, `userId` | `J*****e` |
| `mask_partial` | `address`, `street`, `city`, `zipCode`, `postalCode` | `L*****n` |

Once scrubbing is enabled, this log:

```ts
logger.info('user profile', {
    email: 'jane.doe@example.com',
    password: 'hunter2',
    creditCard: '4111 1111 1111 1111',
    fullName: 'Jane Doe',
})
```

...is stored as:

```json
{
    "msg": "user profile",
    "ctx": {
        "email": "j***@example.com",
        "password": "[REDACTED]",
        "creditCard": "a8f3c1...",
        "fullName": "J*****e"
    }
}
```

Matching is **case-insensitive** by field name, and nested objects are scrubbed too (up to
`maxDepth`).

## Configuration

Scrubbing is configured with the `scrub` option (module options or `frogger.config.ts`), or
per-logger via `useFrogger({ scrub })` / `getFrogger({ scrub })`.

```ts
export interface ScrubberOptions {
    maxDepth?: number       // how deep to recurse into nested objects — default 10
    deepScrub?: boolean     // recurse into nested objects at all — default true
    preserveTypes?: boolean // keep the original type when masking (e.g. redact a number → 0) — default true
    rules?: ScrubRule[]     // custom rules, merged with the defaults
}
```

```ts
// frogger.config.ts
import { defineFroggerOptions } from '#frogger/config'

export default defineFroggerOptions({
    scrub: {
        maxDepth: 6,
        deepScrub: true,
    },
})
```

::: tip Turn it off
Scrubbing is off by default. To turn it back off after enabling it (e.g. via a preset), set
`scrub: false` (not recommended in production).
:::

## Custom rules

Add your own rules to match app-specific fields. A rule pairs an **action** with one or more
**field patterns** (strings or RegExp) and a **priority** — when several rules match a field,
the highest `priority` wins. Your rules are merged with the built-in defaults.

```ts
export interface ScrubRule {
    action: ScrubAction
    fieldPatterns: (string | RegExp)[]
    priority: number
    description?: string
}
```

```ts
// frogger.config.ts
export default defineFroggerOptions({
    scrub: {
        rules: [
            {
                action: 'redact_full',
                fieldPatterns: ['authToken', /.*secret.*/i], // [!code focus]
                priority: 100,                                // [!code focus]
                description: 'Redact app-specific secrets',
            },
            {
                action: 'mask_partial',
                fieldPatterns: ['internalUserRef'],
                priority: 80,
            },
        ],
    },
})
```

### Available actions

| `ScrubAction` | Behaviour |
| --- | --- |
| `redact_full` | Replace the whole value with `[REDACTED]` (or `0` for numbers when `preserveTypes` is on) |
| `mask_first` | Keep the first character, mask the rest |
| `mask_partial` | Keep the first and last character, mask the middle |
| `hash_value` | Replace with a stable hash of the value |
| `mask_email` | Mask the local part of an email, keep the domain |
| `mask_phone` | Keep the first and last digit, mask the digits in between |

::: warning Logs are values, not strings
The scrubber matches on **field names** in your `ctx` object — so prefer structured context
(`logger.error('login failed', { email })`) over interpolating secrets into the message string
(`logger.error('login failed for ' + email)`), which can't be scrubbed by field name.
:::
