import { describe, it, expect } from 'vitest'

import {
    normaliseException,
    templateMessage,
    fingerprintOf,
} from '../src/runtime/shared/utils/exception'

describe('templateMessage', () => {
    it('collapses uuids, numbers and quoted strings', () => {
        expect(templateMessage('order 550e8400-e29b-41d4-a716-446655440000 failed after 3 retries'))
            .toBe('order <uuid> failed after <n> retries')
        expect(templateMessage(`user "alice" not found`)).toBe('user <str> not found')
    })

    it('groups occurrences that differ only in their variable parts', () => {
        // The whole point: 4,000 occurrences of one bug should be one group.
        const a = templateMessage('row 17 missing for tenant 5')
        const b = templateMessage('row 981 missing for tenant 12')
        expect(a).toBe(b)
    })

    it('caps the template so a huge message cannot become a huge key', () => {
        expect(templateMessage('x'.repeat(500)).length).toBeLessThanOrEqual(200)
    })
})

describe('fingerprintOf', () => {
    it('keys on name plus templated message', () => {
        expect(fingerprintOf('TypeError', 'bad id 42', undefined, false))
            .toBe('TypeError|bad id <n>')
    })

    it('adds an app stack frame for server-origin errors only', () => {
        const stack = [
            'TypeError: nope',
            '    at handleCheckout (/app/server/checkout.ts:12:5)',
            '    at Module._compile (node:internal/modules/cjs/loader:1105:14)',
        ].join('\n')

        expect(fingerprintOf('TypeError', 'nope', stack, true)).toContain('handleCheckout')
        // Browser stacks are minified, so a frame would split one error into a
        // fresh group on every deploy.
        expect(fingerprintOf('TypeError', 'nope', stack, false)).not.toContain('handleCheckout')
    })

    it('skips node_modules frames when picking the app frame', () => {
        const stack = [
            'Error: x',
            '    at inner (/app/node_modules/pg/lib/client.js:1:1)',
            '    at myHandler (/app/server/api/orders.ts:9:1)',
        ].join('\n')

        expect(fingerprintOf('Error', 'x', stack, true)).toContain('myHandler')
    })
})

describe('normaliseException', () => {
    it('produces the OTel-shaped keys', () => {
        const { exception, mechanism } = normaliseException(new TypeError('boom'), {
            mechanism: 'nitro-error-hook',
            escaped: true,
            serverOrigin: true,
        })

        expect(exception['exception.type']).toBe('TypeError')
        expect(exception['exception.message']).toBe('boom')
        expect(exception['exception.escaped']).toBe(true)
        expect(exception['exception.stacktrace']).toContain('TypeError')
        expect(mechanism).toBe('nitro-error-hook')
    })

    it('omits the stack when the capture config says not to include it', () => {
        const { exception } = normaliseException(new Error('boom'), {
            mechanism: 'manual',
            includeStack: false,
        })

        expect(exception['exception.stacktrace']).toBeUndefined()
    })

    it('handles a thrown non-Error', () => {
        const { exception } = normaliseException('just a string', { mechanism: 'manual' })

        expect(exception['exception.type']).toBe('Error')
        expect(exception['exception.message']).toBe('just a string')
    })

    it('lets a caller-supplied fingerprint win', () => {
        const { exception } = normaliseException(new Error('boom'), {
            mechanism: 'manual',
            fingerprint: 'checkout-timeout',
        })

        expect(exception['exception.fingerprint']).toBe('checkout-timeout')
    })

    it('defaults escaped to false for a deliberately reported error', () => {
        const { exception } = normaliseException(new Error('handled'), { mechanism: 'manual' })
        expect(exception['exception.escaped']).toBe(false)
    })
})
