import { describe, it, expect } from 'vitest'

import { extractClientIP, extractRateLimitIdentifier, isValidIP } from '../../src/runtime/rate-limiter/utils/identifiers'
import type { H3Event } from 'h3'

/**
 * Minimal H3 event double. `getRequestIP` reads `event.context.clientAddress`
 * before falling back to the socket, so both are populated here.
 */
function event(headers: Record<string, string>, peer = '10.0.0.1'): H3Event {
    return {
        context: { clientAddress: peer },
        node: {
            req: {
                headers,
                socket: { remoteAddress: peer },
                connection: { remoteAddress: peer },
            },
        },
        headers: new Headers(headers),
    } as unknown as H3Event
}

describe('extractClientIP', () => {
    it('ignores forwarding headers by default', () => {
        // The default must not be spoofable: an attacker rotating x-real-ip
        // would otherwise get a fresh bucket on every request.
        const ip = extractClientIP(event({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }))
        expect(ip).toBe('10.0.0.1')
    })

    it('takes the last forwarded hop when one proxy is trusted', () => {
        // Counted from the RIGHT: the leftmost entry is whatever the client
        // claimed, the rightmost was appended by the proxy we trust.
        const ip = extractClientIP(event({ 'x-forwarded-for': '9.9.9.9, 203.0.113.5' }), true)
        expect(ip).toBe('203.0.113.5')
    })

    it('skips the configured number of hops', () => {
        const ip = extractClientIP(event({ 'x-forwarded-for': '9.9.9.9, 203.0.113.5, 198.51.100.2' }), 2)
        expect(ip).toBe('203.0.113.5')
    })

    it('honours forwarding only from a listed peer', () => {
        const headers = { 'x-forwarded-for': '203.0.113.5' }

        expect(extractClientIP(event(headers, '10.0.0.1'), ['10.0.0.1'])).toBe('203.0.113.5')
        expect(extractClientIP(event(headers, '10.0.0.99'), ['10.0.0.1'])).toBe('10.0.0.99')
    })

    it('falls back to the peer when the forwarded value is not an address', () => {
        expect(extractClientIP(event({ 'x-forwarded-for': 'not-an-ip' }), true)).toBe('10.0.0.1')
    })
})

describe('extractRateLimitIdentifier', () => {
    it('drops header-derived tiers on an unauthenticated request', () => {
        // Both headers are attacker-supplied: each unique value would otherwise
        // mint a fresh storage key, so rotating them defeats the limiter.
        const id = extractRateLimitIdentifier(event({
            'x-frogger-reporter-id': 'anything',
            'x-frogger-source': 'pretend-app',
        }))

        expect(id.reporterId).toBeUndefined()
        expect(id.appName).toBeUndefined()
        expect(id.ip).toBe('10.0.0.1')
    })

    it('honours them once the request is authenticated', () => {
        const id = extractRateLimitIdentifier(event({
            'x-api-key': 'server-key',
            'x-frogger-reporter-id': 'reporter-1',
            'x-frogger-source': 'billing',
        }))

        expect(id.reporterId).toBe('reporter-1')
        expect(id.appName).toBe('billing')
    })

    it('caps a header-derived key so it cannot become an unbounded storage key', () => {
        const id = extractRateLimitIdentifier(event({
            'x-api-key': 'server-key',
            'x-frogger-source': 'x'.repeat(5000),
        }))

        expect(id.appName).toHaveLength(128)
    })
})

describe('isValidIP', () => {
    it('accepts v4 and v6 forms', () => {
        expect(isValidIP('203.0.113.5')).toBe(true)
        expect(isValidIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
        expect(isValidIP('::1')).toBe(true)
    })

    it('rejects anything else', () => {
        expect(isValidIP('999.1.1.1')).toBe(false)
        expect(isValidIP('not-an-ip')).toBe(false)
        expect(isValidIP('')).toBe(false)
    })
})
