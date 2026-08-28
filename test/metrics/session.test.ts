import { describe, it, expect } from 'vitest'

import { decideSampled, parseSession } from '../../src/runtime/shared/session'

describe('decideSampled', () => {
    it('rate >= 1 always samples, regardless of the draw', () => {
        expect(decideSampled(1, 0.99)).toBe(true)
        expect(decideSampled(1.5, 0.0)).toBe(true)
    })

    it('rate <= 0 never samples, regardless of the draw', () => {
        expect(decideSampled(0, 0.0)).toBe(false)
        expect(decideSampled(-1, 0.0)).toBe(false)
    })

    it('is a deterministic threshold on the draw', () => {
        expect(decideSampled(0.5, 0.49)).toBe(true)
        expect(decideSampled(0.5, 0.5)).toBe(false)
        expect(decideSampled(0.5, 0.51)).toBe(false)
    })
})

describe('parseSession', () => {
    it('parses a valid persisted record', () => {
        expect(parseSession('{"id":"abc","sampled":true}')).toEqual({ id: 'abc', sampled: true })
    })

    it('returns null for absent / corrupt / mistyped records', () => {
        expect(parseSession(null)).toBeNull()
        expect(parseSession('')).toBeNull()
        expect(parseSession('not json')).toBeNull()
        expect(parseSession('{"id":"abc"}')).toBeNull()
        expect(parseSession('{"id":1,"sampled":true}')).toBeNull()
    })
})
