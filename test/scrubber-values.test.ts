import { describe, it, expect } from 'vitest'

import { LogScrubber } from '../src/runtime/scrubber/index'
import { scrubStringValue, passesLuhn, DEFAULT_VALUE_PATTERNS } from '../src/runtime/scrubber/value-patterns'
import { applyStrategy, SCRUB_STRATEGY } from '../src/runtime/scrubber/strategies'
import type { LoggerObject } from '../src/runtime/shared/types/log'

function row(ctx: Record<string, unknown>, msg = 'hello'): LoggerObject {
    return {
        id: 'id-1', time: Date.now(), lvl: 3, sev: 9, type: 'info', msg, ctx,
        env: 'server', trace: { traceId: 't', spanId: 's' },
    }
}

describe('value patterns', () => {
    it('redacts an email regardless of the key it sits under', () => {
        // A key rule cannot catch a value pasted into a free-form field.
        expect(scrubStringValue('contact a@b.test please', DEFAULT_VALUE_PATTERNS))
            .toBe('contact [REDACTED:email] please')
    })

    it('redacts a bearer token and a JWT', () => {
        expect(scrubStringValue('Bearer abc.def-ghi', DEFAULT_VALUE_PATTERNS)).toContain('[REDACTED:bearer]')
        expect(scrubStringValue('eyJhbGciOi.eyJzdWIi.SflKxwRJ', DEFAULT_VALUE_PATTERNS)).toContain('[REDACTED:jwt]')
    })

    it('redacts a Luhn-valid card number', () => {
        expect(scrubStringValue('card 4242424242424242', DEFAULT_VALUE_PATTERNS)).toContain('[REDACTED:card]')
    })

    it('leaves a long digit run that is not a card alone', () => {
        // Without the Luhn check this pattern also swallows order ids and
        // timestamps, redacting real data that was never sensitive.
        expect(scrubStringValue('order 1234567890123456', DEFAULT_VALUE_PATTERNS))
            .toBe('order 1234567890123456')
    })

    it('returns the input unchanged when nothing matched', () => {
        const input = 'nothing to see here'
        expect(scrubStringValue(input, DEFAULT_VALUE_PATTERNS)).toBe(input)
    })

    it('is reusable across calls despite global regexes', () => {
        // A global regex carries lastIndex; without a reset the second call
        // would start mid-string and miss.
        const first = scrubStringValue('a@b.test', DEFAULT_VALUE_PATTERNS)
        const second = scrubStringValue('a@b.test', DEFAULT_VALUE_PATTERNS)
        expect(second).toBe(first)
    })
})

describe('passesLuhn', () => {
    it('accepts a valid card and rejects an invalid one', () => {
        expect(passesLuhn('4242424242424242')).toBe(true)
        expect(passesLuhn('4242 4242 4242 4242')).toBe(true)
        expect(passesLuhn('1234567890123456')).toBe(false)
    })

    it('rejects lengths outside the card range', () => {
        expect(passesLuhn('42424')).toBe(false)
        expect(passesLuhn('4'.repeat(25))).toBe(false)
    })
})

describe('LogScrubber value scrubbing', () => {
    it('is off unless asked for', () => {
        const scrubber = new LogScrubber({ rules: [] })
        const log = row({ note: 'mail me at a@b.test' })

        scrubber.scrubLoggerObject(log)

        expect(log.ctx.note).toBe('mail me at a@b.test')
    })

    it('redacts a value under a key no rule names', () => {
        const scrubber = new LogScrubber({ rules: [], values: true })
        const log = row({ note: 'mail me at a@b.test' })

        scrubber.scrubLoggerObject(log)

        expect(log.ctx.note).toBe('mail me at [REDACTED:email]')
    })

    it('reaches values inside arrays', () => {
        const scrubber = new LogScrubber({ rules: [], values: true })
        const log = row({ notes: ['ok', 'a@b.test'] })

        scrubber.scrubLoggerObject(log)

        expect(log.ctx.notes).toEqual(['ok', '[REDACTED:email]'])
    })

    it('leaves the message alone unless message scrubbing is on too', () => {
        const ctxOnly = new LogScrubber({ rules: [], values: true })
        const log = row({}, 'user a@b.test signed in')

        ctxOnly.scrubLoggerObject(log)
        expect(log.msg).toBe('user a@b.test signed in')

        const withMessage = new LogScrubber({ rules: [], values: true, message: true })
        withMessage.scrubLoggerObject(log)
        expect(log.msg).toBe('user [REDACTED:email] signed in')
    })

    it('accepts a custom pattern set', () => {
        const scrubber = new LogScrubber({
            rules: [],
            values: [{ name: 'ticket', pattern: /TICKET-\d+/g, replacement: '[TICKET]' }],
        })
        const log = row({ note: 'see TICKET-42' })

        scrubber.scrubLoggerObject(log)

        expect(log.ctx.note).toBe('see [TICKET]')
    })
})

describe('hash strategy', () => {
    it('is stable for the same input, so values still correlate across rows', () => {
        expect(applyStrategy('user-42', SCRUB_STRATEGY.HASH, { preserveTypes: true }))
            .toBe(applyStrategy('user-42', SCRUB_STRATEGY.HASH, { preserveTypes: true }))
    })

    it('produces a 64-bit token, not the old 32-bit one', () => {
        // At 32 bits, two unrelated users collided to one token at around
        // 77,000 distinct values, silently merging their rows.
        const hashed = applyStrategy('user-42', SCRUB_STRATEGY.HASH, { preserveTypes: true }) as string
        expect(hashed).toMatch(/^\[HASH:[0-9a-f]{16}\]$/)
    })

    it('distinguishes different inputs', () => {
        expect(applyStrategy('a', SCRUB_STRATEGY.HASH, { preserveTypes: true }))
            .not.toBe(applyStrategy('b', SCRUB_STRATEGY.HASH, { preserveTypes: true }))
    })
})
