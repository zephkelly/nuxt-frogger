/**
 * Scrubbing strategies: the primitive value-masking operations Frogger provides.
 *
 * Each strategy is a serialisable STRING TOKEN (never a function) so a rule set
 * survives being written into Nuxt runtime config and crossing the SSR→client
 * boundary as JSON. The masking logic lives here; {@link LogScrubber} dispatches
 * to `applyStrategy`.
 */

export const SCRUB_STRATEGY = {
    /** Replace the whole value with `[REDACTED]` (numbers → 0; booleans kept when preserveTypes). */
    REDACT: 'redact',
    /** Replace every character with `*`, preserving length. */
    MASK_ALL: 'mask_all',
    /** Keep the first character, mask the rest. */
    KEEP_FIRST: 'keep_first',
    /** Keep the last character, mask the rest. */
    KEEP_LAST: 'keep_last',
    /** Keep the first and last character, mask the middle (length-preserving). */
    KEEP_ENDS: 'keep_ends',
    /** Replace with a stable, non-reversible hash. */
    HASH: 'hash',
    /** Mask an email local-part, keep the domain (`j***@example.com`). */
    MASK_EMAIL: 'mask_email',
    /** Keep the first and last digit of a phone number, mask the rest. */
    MASK_PHONE: 'mask_phone',
    /** Keep the last 4 digits of a card number, mask the rest. */
    MASK_CARD: 'mask_card',
} as const

export type ScrubStrategy = typeof SCRUB_STRATEGY[keyof typeof SCRUB_STRATEGY]

/**
 * Legacy `SCRUB_ACTION` tokens (pre-0.2) mapped onto the current strategies so
 * previously-authored rules and serialised config keep working.
 */
const LEGACY_ALIASES: Record<string, ScrubStrategy> = {
    redact_full: SCRUB_STRATEGY.REDACT,
    mask_first: SCRUB_STRATEGY.KEEP_FIRST,
    mask_partial: SCRUB_STRATEGY.KEEP_ENDS,
    hash_value: SCRUB_STRATEGY.HASH,
}

export function normaliseStrategy(action: string): ScrubStrategy {
    return LEGACY_ALIASES[action] ?? (action as ScrubStrategy)
}

export interface ApplyStrategyOptions {
    preserveTypes: boolean
}

export function isEmptyValue(value: unknown): boolean {
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
    return false
}

/**
 * Apply a strategy to a single value. Returns the value unchanged when there is
 * nothing meaningful to mask (null/undefined/empty, or a boolean under
 * `preserveTypes` — a boolean flag carries no PII and redacting it to a string
 * would corrupt the record's type).
 */
export function applyStrategy(value: unknown, action: string, opts: ApplyStrategyOptions): unknown {
    if (value === null || value === undefined) return value
    if (isEmptyValue(value)) return value

    const strategy = normaliseStrategy(action)
    const str = String(value)

    switch (strategy) {
        case SCRUB_STRATEGY.REDACT:
            if (opts.preserveTypes && typeof value === 'number') return 0
            if (opts.preserveTypes && typeof value === 'boolean') return value
            return '[REDACTED]'

        case SCRUB_STRATEGY.MASK_ALL:
            return '*'.repeat(str.length)

        case SCRUB_STRATEGY.KEEP_FIRST:
            if (str.length <= 1) return '*'
            return str[0] + '*'.repeat(str.length - 1)

        case SCRUB_STRATEGY.KEEP_LAST:
            if (str.length <= 1) return '*'
            return '*'.repeat(str.length - 1) + str[str.length - 1]

        case SCRUB_STRATEGY.KEEP_ENDS:
            if (str.length <= 2) return '*'.repeat(str.length)
            return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1]

        case SCRUB_STRATEGY.HASH:
            return simpleHash(str)

        case SCRUB_STRATEGY.MASK_EMAIL:
            return maskEmail(str)

        case SCRUB_STRATEGY.MASK_PHONE:
            return maskPhone(str)

        case SCRUB_STRATEGY.MASK_CARD:
            return maskCard(str)

        default:
            return value
    }
}

function maskEmail(email: string): string {
    const match = email.match(/^([^@]+)@(.+)$/)
    if (!match) return email

    const [, localPart, domain] = match
    if (!localPart) return email
    if (localPart.length <= 1) return `*@${domain}`

    return `${localPart[0]}***@${domain}`
}

function maskPhone(phone: string): string {
    const chars = phone.split('')
    const digitIndices: number[] = []

    for (let i = 0; i < chars.length; i++) {
        if (/\d/.test(chars[i]!)) digitIndices.push(i)
    }

    if (digitIndices.length < 4) return phone

    for (let i = 1; i < digitIndices.length - 1; i++) {
        chars[digitIndices[i]!] = '*'
    }

    return chars.join('')
}

/** Keep the last 4 digits, mask every earlier digit; non-digits are preserved. */
function maskCard(card: string): string {
    const chars = card.split('')
    const digitIndices: number[] = []

    for (let i = 0; i < chars.length; i++) {
        if (/\d/.test(chars[i]!)) digitIndices.push(i)
    }

    if (digitIndices.length <= 4) return card

    const maskUntil = digitIndices.length - 4
    for (let i = 0; i < maskUntil; i++) {
        chars[digitIndices[i]!] = '*'
    }

    return chars.join('')
}

function simpleHash(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash
    }
    return `[HASH:${Math.abs(hash).toString(16)}]`
}
