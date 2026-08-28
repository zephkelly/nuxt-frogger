import { describe, it, expect } from 'vitest'

import {
    parseTraceparent,
    extractTraceContext,
    generateW3CTraceHeaders,
    mergeTracestate,
    isSampled,
} from '../../src/runtime/shared/utils/trace-headers'

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN = '00f067aa0ba902b7'

describe('parseTraceparent', () => {
    it('parses a well-formed header including its flags', () => {
        expect(parseTraceparent(`00-${TRACE}-${SPAN}-00`)).toEqual({
            traceId: TRACE,
            spanId: SPAN,
            flags: '00',
        })
    })

    it('rejects a malformed trace id rather than adopting it', () => {
        // Ids come from an untrusted peer; adopting one poisons every row that
        // continues from it.
        expect(parseTraceparent(`00-not-a-trace-${SPAN}-01`)).toBeNull()
        expect(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN}-01`)).toBeNull()
    })

    it('rejects a malformed span id', () => {
        expect(parseTraceparent(`00-${TRACE}-nope-01`)).toBeNull()
        expect(parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`)).toBeNull()
    })

    it('drops malformed flags instead of propagating them', () => {
        expect(parseTraceparent(`00-${TRACE}-${SPAN}-zz`)?.flags).toBeUndefined()
    })

    it('rejects an unknown version', () => {
        expect(parseTraceparent(`99-${TRACE}-${SPAN}-01`)).toBeNull()
    })
})

describe('extractTraceContext', () => {
    it('reads the traceparent header in either casing', () => {
        expect(extractTraceContext({ traceparent: `00-${TRACE}-${SPAN}-01` })?.traceId).toBe(TRACE)
        expect(extractTraceContext({ Traceparent: `00-${TRACE}-${SPAN}-01` })?.traceId).toBe(TRACE)
    })

    it('returns null when there is no trace to continue', () => {
        expect(extractTraceContext({})).toBeNull()
    })
})

describe('isSampled', () => {
    it('reads the sampled bit', () => {
        expect(isSampled('01')).toBe(true)
        expect(isSampled('00')).toBe(false)
        expect(isSampled('03')).toBe(true)
    })

    it('treats an absent decision as sampled', () => {
        expect(isSampled(undefined)).toBe(true)
    })
})

describe('generateW3CTraceHeaders', () => {
    it('re-emits supplied flags rather than fabricating 01', () => {
        // An upstream that decided NOT to sample must not have that decision
        // silently reversed at this hop.
        const headers = generateW3CTraceHeaders({ traceId: TRACE, parentSpanId: SPAN, flags: '00' })
        expect(headers.traceparent).toBe(`00-${TRACE}-${SPAN}-00`)
    })

    it('ignores malformed supplied flags and falls back to the sampled flag', () => {
        const headers = generateW3CTraceHeaders({ traceId: TRACE, parentSpanId: SPAN, flags: 'xx', sampled: false })
        expect(headers.traceparent.endsWith('-00')).toBe(true)
    })

    it('carries an inbound tracestate forward with its own entry first', () => {
        const headers = generateW3CTraceHeaders({
            traceId: TRACE,
            parentSpanId: SPAN,
            vendorData: { frogger: 'abc' },
            inboundTracestate: 'other=xyz,third=123',
        })
        expect(headers.tracestate).toBe('frogger=abc,other=xyz,third=123')
    })
})

describe('mergeTracestate', () => {
    it('returns only the inbound entries when this hop has none', () => {
        expect(mergeTracestate({}, 'other=xyz')).toBe('other=xyz')
    })

    it('replaces a stale entry for a key it is rewriting', () => {
        expect(mergeTracestate({ frogger: 'new' }, 'frogger=old,other=xyz'))
            .toBe('frogger=new,other=xyz')
    })

    it('caps the list at the W3C limit of 32 entries', () => {
        const inbound = Array.from({ length: 40 }, (_, i) => `v${i}=x`).join(',')
        expect(mergeTracestate({ frogger: 'a' }, inbound)!.split(',')).toHaveLength(32)
    })

    it('returns undefined when there is nothing to send', () => {
        expect(mergeTracestate({}, undefined)).toBeUndefined()
    })
})
