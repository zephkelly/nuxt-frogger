import { describe, it, expect } from 'vitest'
import { normalizeLogArgs } from '../../src/runtime/shared/utils/normalize-log-args'

describe('normalizeLogArgs', () => {
    it('returns an empty message for no args', () => {
        expect(normalizeLogArgs([])).toEqual({ message: '' })
    })

    it('passes a lone string through verbatim with no context', () => {
        expect(normalizeLogArgs(['hello world'])).toEqual({ message: 'hello world' })
    })

    it('keeps Frogger-style (message, context) identical', () => {
        const ctx = { userId: 7 }
        const result = normalizeLogArgs(['user signed in', ctx])
        expect(result.message).toBe('user signed in')
        expect(result.context).toBe(ctx) // same reference — no clone when no error
    })

    it('joins multiple leading args into the message', () => {
        expect(normalizeLogArgs(['count', 5, 'done'])).toEqual({ message: 'count 5 done' })
    })

    it('lifts only a TRAILING plain object into context', () => {
        const result = normalizeLogArgs(['a', 'b', { x: 1 }])
        expect(result.message).toBe('a b')
        expect(result.context).toEqual({ x: 1 })
    })

    it('treats a lone plain object as context with empty message', () => {
        const result = normalizeLogArgs([{ a: 1 }])
        expect(result.message).toBe('')
        expect(result.context).toEqual({ a: 1 })
    })

    it('does NOT treat an array as context', () => {
        const result = normalizeLogArgs(['items', [1, 2, 3]])
        expect(result.context).toBeUndefined()
        expect(result.message).toBe('items [1,2,3]')
    })

    it('does NOT treat a Date as context', () => {
        const d = new Date('2020-01-01T00:00:00.000Z')
        const result = normalizeLogArgs(['at', d])
        expect(result.context).toBeUndefined()
    })

    it('does NOT treat a class instance as context', () => {
        class Widget { foo = 1 }
        const result = normalizeLogArgs(['w', new Widget()])
        expect(result.context).toBeUndefined()
    })

    it('treats an Object.create(null) bag as a plain object context', () => {
        const bag = Object.create(null)
        bag.k = 'v'
        const result = normalizeLogArgs(['msg', bag])
        expect(result.context).toEqual({ k: 'v' })
    })

    it('lifts an Error into context.error and folds its message into the text', () => {
        const err = new Error('boom')
        const result = normalizeLogArgs(['checkout failed', err])
        expect(result.message).toBe('checkout failed boom')
        expect(result.context?.error).toMatchObject({ name: 'Error', message: 'boom' })
        expect(result.context?.error.stack).toBeTypeOf('string')
    })

    it('combines an Error with a trailing context object without mutating the caller object', () => {
        const err = new TypeError('bad type')
        const userCtx = { reqId: 'abc' }
        const result = normalizeLogArgs(['failed', err, userCtx])
        expect(result.message).toBe('failed bad type')
        expect(result.context).toMatchObject({ reqId: 'abc' })
        expect(result.context?.error).toMatchObject({ name: 'TypeError', message: 'bad type' })
        // caller's object is untouched
        expect(userCtx).toEqual({ reqId: 'abc' })
        expect(result.context).not.toBe(userCtx)
    })

    it('does not overwrite an explicit context.error', () => {
        const err = new Error('real')
        const result = normalizeLogArgs(['x', err, { error: 'explicit' }])
        expect(result.context?.error).toBe('explicit')
    })

    it('safe-stringifies plain values and falls back gracefully on cyclic objects', () => {
        const cyclic: any = { a: 1 }
        cyclic.self = cyclic
        // cyclic is the trailing arg -> treated as context, so message is just the leader
        const result = normalizeLogArgs(['v', cyclic])
        expect(result.message).toBe('v')
        expect(result.context).toBe(cyclic)
    })
})
