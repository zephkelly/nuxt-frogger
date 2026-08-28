/**
 * Value-shaped redaction: match on what a string LOOKS like, not on the key it
 * sits under.
 *
 * Key-based rules cannot catch a token pasted into a `note` field or an email
 * inside a message. These can - at the cost of running regexes over every
 * string in every log, which is why they are entirely opt-in and off by
 * default: the zero-config hot path stays free.
 */

export interface ValuePattern {
    /** Diagnostic name; appears in `fieldsModified`. */
    name: string
    pattern: RegExp
    /** Replacement. `$&`-style references are NOT expanded. */
    replacement: string
}

/**
 * The default set. Deliberately small and high-confidence: a pattern that
 * misfires silently corrupts data, which is worse than one that misses.
 */
export const DEFAULT_VALUE_PATTERNS: ValuePattern[] = [
    {
        name: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        replacement: '[REDACTED:email]',
    },
    {
        name: 'bearer',
        pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
        replacement: '[REDACTED:bearer]',
    },
    {
        // Three base64url segments: the shape of a JWT.
        name: 'jwt',
        pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g,
        replacement: '[REDACTED:jwt]',
    },
    {
        // 13-19 digits with optional separators: a card-shaped number. Luhn is
        // checked separately so an order id of the same length survives.
        name: 'card',
        pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
        replacement: '[REDACTED:card]',
    },
]

/**
 * Apply patterns to one string. Returns the input unchanged (same reference)
 * when nothing matched, so the caller's copy-on-write stays cheap.
 */
export function scrubStringValue(value: string, patterns: ValuePattern[]): string {
    let result = value

    for (const { pattern, replacement, name } of patterns) {
        // A global regex carries lastIndex between calls; resetting keeps the
        // pattern objects reusable across values.
        pattern.lastIndex = 0

        if (name === 'card') {
            result = result.replace(pattern, match => (passesLuhn(match) ? replacement : match))
            continue
        }

        result = result.replace(pattern, replacement)
    }

    return result
}

/**
 * Luhn check. Without it the card pattern also swallows order ids, timestamps
 * and any other long digit run - redacting real data that was never sensitive.
 */
export function passesLuhn(value: string): boolean {
    const digits = value.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) return false

    let sum = 0
    let double = false

    for (let i = digits.length - 1; i >= 0; i--) {
        let digit = digits.charCodeAt(i) - 48

        if (double) {
            digit *= 2
            if (digit > 9) digit -= 9
        }

        sum += digit
        double = !double
    }

    return sum % 10 === 0
}
