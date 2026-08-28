import { describe, it, expect } from 'vitest'

import { routePatternOf, isSelfRequest, HTTP_DURATION_BUCKETS } from '../../src/runtime/metrics/shared/utils/request-metrics'
import { shouldPropagateTrace, isSameOrigin, urlOf } from '../../src/runtime/shared/utils/trace-propagation'
import type { H3Event } from 'h3'

const event = (context: Record<string, unknown>) => ({ context }) as unknown as H3Event

describe('routePatternOf', () => {
    it('returns the matched route pattern', () => {
        expect(routePatternOf(event({ matchedRoute: { path: '/orders/[id]' } }))).toBe('/orders/[id]')
    })

    it('returns undefined when no pattern was matched', () => {
        // The caller drops the measurement rather than falling back to the raw
        // path: `/orders/1`, `/orders/2`... is one series per order otherwise.
        expect(routePatternOf(event({}))).toBeUndefined()
        expect(routePatternOf(event({ matchedRoute: {} }))).toBeUndefined()
        expect(routePatternOf(event({ matchedRoute: { path: '' } }))).toBeUndefined()
    })
})

describe('isSelfRequest', () => {
    it('recognises frogger ingest routes', () => {
        // Instrumenting our own ingest is a feedback loop: the metric produces
        // the batch that produces the next metric.
        expect(isSelfRequest('/api/_frogger/logs')).toBe(true)
        expect(isSelfRequest('/api/_frogger/metrics')).toBe(true)
    })

    it('leaves application routes alone', () => {
        expect(isSelfRequest('/api/orders')).toBe(false)
        expect(isSelfRequest(undefined)).toBe(false)
    })
})

describe('HTTP_DURATION_BUCKETS', () => {
    it('is OTel\'s standard set, in seconds and ascending', () => {
        expect(HTTP_DURATION_BUCKETS[0]).toBe(0.005)
        expect(HTTP_DURATION_BUCKETS.at(-1)).toBe(10)
        const sorted = [...HTTP_DURATION_BUCKETS].sort((a, b) => a - b)
        expect([...HTTP_DURATION_BUCKETS]).toEqual(sorted)
    })
})

const ORIGIN = 'https://app.example.com'

describe('isSameOrigin', () => {
    it('treats relative urls as same-origin', () => {
        expect(isSameOrigin('/api/orders', ORIGIN)).toBe(true)
        expect(isSameOrigin('api/orders', ORIGIN)).toBe(true)
    })

    it('compares absolute urls by origin', () => {
        expect(isSameOrigin('https://app.example.com/api', ORIGIN)).toBe(true)
        expect(isSameOrigin('https://other.example.com/api', ORIGIN)).toBe(false)
    })

    it('does not treat a protocol-relative url as same-origin', () => {
        expect(isSameOrigin('//evil.test/api', ORIGIN)).toBe(false)
    })
})

describe('shouldPropagateTrace', () => {
    it('allows same-origin by default and nothing else', () => {
        // The default that stops internal trace ids reaching every third-party
        // endpoint the page happens to call.
        expect(shouldPropagateTrace('/api/orders', ORIGIN, {})).toBe(true)
        expect(shouldPropagateTrace('https://analytics.test/collect', ORIGIN, {})).toBe(false)
    })

    it('propagates nothing when disabled', () => {
        expect(shouldPropagateTrace('/api/orders', ORIGIN, false)).toBe(false)
    })

    it('allows an explicit string prefix', () => {
        expect(shouldPropagateTrace('https://api.example.com/v1', ORIGIN, {
            urls: ['https://api.example.com/'],
        })).toBe(true)
    })

    it('honours an anchored RegExp and is defeated by an unanchored one', () => {
        const anchored = /^https:\/\/api\.example\.com\//
        const unanchored = /api\.example\.com/

        expect(shouldPropagateTrace('https://api.example.com/v1', ORIGIN, { urls: [anchored] })).toBe(true)

        // The cautionary case, copied from Datadog's incident: an unanchored
        // matcher also matches an attacker-controlled URL that merely mentions
        // the host.
        const decoy = 'https://evil.test/?x=api.example.com'
        expect(shouldPropagateTrace(decoy, ORIGIN, { urls: [anchored] })).toBe(false)
        expect(shouldPropagateTrace(decoy, ORIGIN, { urls: [unanchored] })).toBe(true)
    })

    it('supports a predicate matcher', () => {
        expect(shouldPropagateTrace('https://api.example.com/v1', ORIGIN, {
            urls: [(url: string) => new URL(url).hostname === 'api.example.com'],
        })).toBe(true)
    })

    it('treats a throwing matcher as no', () => {
        expect(shouldPropagateTrace('https://x.test/', ORIGIN, {
            urls: [() => { throw new Error('boom') }],
        })).toBe(false)
    })
})

describe('urlOf', () => {
    it('reads every shape ofetch accepts', () => {
        expect(urlOf('/api')).toBe('/api')
        expect(urlOf(new URL('https://x.test/api'))).toBe('https://x.test/api')
        expect(urlOf({ url: '/api' })).toBe('/api')
        expect(urlOf(undefined)).toBe('')
    })
})
