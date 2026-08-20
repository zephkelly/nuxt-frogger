import { describe, it, expect } from 'vitest'

import {
    serializeError,
    normalizeContextErrors,
    markErrorLogged,
    isErrorLogged,
} from '../src/runtime/shared/utils/normalize-errors'

describe('serializeError', () => {
    it('captures the non-enumerable name/message/stack as plain fields', () => {
        const err = new TypeError('bad input')
        const serialized = serializeError(err)

        expect(serialized.name).toBe('TypeError')
        expect(serialized.message).toBe('bad input')
        expect(typeof serialized.stack).toBe('string')
        expect(JSON.parse(JSON.stringify(serialized)).message).toBe('bad input')
    })

    it('keeps enumerable own props (pg/ofetch style) alongside the canonical fields', () => {
        const err = new Error('db down') as Error & { code?: string, statusCode?: number }
        err.code = '23505'
        err.statusCode = 500

        const serialized = serializeError(err)
        expect(serialized.code).toBe('23505')
        expect(serialized.statusCode).toBe(500)
        expect(serialized.message).toBe('db down')
    })

    it('canonical fields win over enumerable shadows', () => {
        const err = new Error('real message')
        Object.defineProperty(err, 'message', { value: 'real message', enumerable: false })
        Object.assign(err, { name: 'garbage' })

        const serialized = serializeError(err)
        expect(serialized.message).toBe('real message')
    })

    it('serialises Error causes recursively, depth-bounded', () => {
        const root = new Error('root')
        const mid = new Error('mid', { cause: root })
        const top = new Error('top', { cause: mid })

        const serialized = serializeError(top)
        const cause = serialized.cause as Record<string, unknown>
        expect(cause.message).toBe('mid')
        expect((cause.cause as Record<string, unknown>).message).toBe('root')
    })

    it('stamps the error as logged', () => {
        const err = new Error('x')
        expect(isErrorLogged(err)).toBe(false)
        serializeError(err)
        expect(isErrorLogged(err)).toBe(true)
    })
})

describe('normalizeContextErrors', () => {
    it('flattens an Error at ctx.error to a JSON-safe object', () => {
        const err = new Error('kaput')
        const ctx = normalizeContextErrors({ error: err, feature: 'billing' })

        const roundTripped = JSON.parse(JSON.stringify(ctx))
        expect(roundTripped.error.message).toBe('kaput')
        expect(roundTripped.error.name).toBe('Error')
        expect(roundTripped.feature).toBe('billing')
    })

    it('finds Errors nested in objects and arrays', () => {
        const ctx = normalizeContextErrors({
            results: [{ ok: true }, { failure: new Error('deep') }],
        })

        const results = ctx.results as Array<Record<string, unknown>>
        expect((results[1]!.failure as Record<string, unknown>).message).toBe('deep')
        expect(JSON.parse(JSON.stringify(ctx)).results[1].failure.message).toBe('deep')
    })

    it('never mutates the caller\'s object graph', () => {
        const err = new Error('kaput')
        const nested = { error: err }
        const original = { nested }

        const ctx = normalizeContextErrors(original)

        expect(original.nested.error).toBe(err)
        expect(ctx.nested).not.toBe(nested)
        expect((ctx.nested as Record<string, unknown>).error).not.toBe(err)
    })

    it('returns untouched subtrees by reference', () => {
        const clean = { a: 1, b: { c: 2 } }
        const ctx = normalizeContextErrors({ clean, error: new Error('x') })
        expect(ctx.clean).toBe(clean)
    })

    it('is cycle-safe', () => {
        const a: Record<string, unknown> = { error: new Error('loop') }
        a.self = a
        expect(() => normalizeContextErrors({ a })).not.toThrow()
    })

    it('passes non-plain objects through untouched', () => {
        const date = new Date(0)
        const ctx = normalizeContextErrors({ date })
        expect(ctx.date).toBe(date)
    })
})

describe('logged-error stamp', () => {
    it('markErrorLogged is idempotent and survives non-error input', () => {
        const err = new Error('x')
        markErrorLogged(err)
        markErrorLogged(err)
        expect(isErrorLogged(err)).toBe(true)

        expect(() => markErrorLogged(null)).not.toThrow()
        expect(() => markErrorLogged('nope')).not.toThrow()
        expect(isErrorLogged(null)).toBe(false)
    })

    it('the stamp is non-enumerable so it never leaks into serialised output', () => {
        const err = new Error('x')
        markErrorLogged(err)
        expect(Object.keys(err)).toHaveLength(0)
        expect(JSON.stringify(serializeError(err))).not.toContain('nuxt-frogger.logged')
    })
})
