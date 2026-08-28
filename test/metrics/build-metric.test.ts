import { describe, it, expect } from 'vitest'

import { buildMetric } from '../../src/runtime/metrics/shared/api/build-metric'
import type { MetricStamp } from '../../src/runtime/metrics/shared/api/types'

const stamp: MetricStamp = { env: 'server' }

const fullStamp: MetricStamp = {
    env: 'client',
    trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    session: { id: 'sess-1', sampled: true },
    user: 'user-public-1',
    route: '/habits/[id]',
}

describe('buildMetric', () => {
    it('builds a minimal point from name, kind and value', () => {
        const m = buildMetric('app.thing', 'counter', 1, { time: 1000 }, stamp)

        expect(m).toEqual({ time: 1000, name: 'app.thing', kind: 'counter', value: 1, env: 'server' })
    })

    it('carries unit, labels and attr through unchanged', () => {
        const m = buildMetric('db.query.duration', 'histogram', 0.031, {
            time: 1000,
            unit: 'second',
            labels: { op: 'select' },
            attr: { statement: 'users-by-id' },
        }, stamp)

        expect(m!.unit).toBe('second')
        expect(m!.labels).toEqual({ op: 'select' })
        expect(m!.attr).toEqual({ statement: 'users-by-id' })
    })

    describe('rejects a point that could not be stored', () => {
        it.each([
            ['an empty name', '', 1],
            ['a whitespace-only name', '   ', 1],
        ])('%s', (_label, name, value) => {
            expect(buildMetric(name, 'counter', value, { time: 1000 }, stamp)).toBeNull()
        })

        it.each([
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
            ['-Infinity', Number.NEGATIVE_INFINITY],
        ])('a %s value', (_label, value) => {
            expect(buildMetric('app.thing', 'gauge', value, { time: 1000 }, stamp)).toBeNull()
        })

        it.each([
            ['zero', 0],
            ['negative', -1],
            ['non-finite', Number.NaN],
        ])('a %s timestamp', (_label, time) => {
            expect(buildMetric('app.thing', 'counter', 1, { time }, stamp)).toBeNull()
        })
    })

    it('trims the name and truncates a fractional timestamp', () => {
        const m = buildMetric('  app.thing  ', 'counter', 1, { time: 1000.9 }, stamp)

        expect(m!.name).toBe('app.thing')
        expect(m!.time).toBe(1000)
    })

    it('accepts a zero and a negative value', () => {
        expect(buildMetric('app.thing', 'gauge', 0, { time: 1000 }, stamp)!.value).toBe(0)
        expect(buildMetric('app.delta', 'gauge', -3, { time: 1000 }, stamp)!.value).toBe(-3)
    })

    describe('correlation', () => {
        it('stamps trace, session and user from the ambient stamp', () => {
            const m = buildMetric('app.thing', 'counter', 1, { time: 1000 }, fullStamp)

            expect(m!.trace).toEqual({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })
            expect(m!.session).toEqual({ id: 'sess-1', sampled: true })
            expect(m!.user).toBe('user-public-1')
        })

        it('puts route in labels, where it can be grouped on', () => {
            const m = buildMetric('app.thing', 'counter', 1, { time: 1000 }, fullStamp)

            expect(m!.labels).toEqual({ route: '/habits/[id]' })
        })

        it('lets an explicit route label win over the ambient reading', () => {
            const m = buildMetric('app.thing', 'counter', 1, {
                time: 1000,
                labels: { route: '/explicit' },
            }, fullStamp)

            expect(m!.labels!.route).toBe('/explicit')
        })

        it('never puts the user id in labels, which would multiply the series count', () => {
            const m = buildMetric('app.thing', 'counter', 1, { time: 1000 }, fullStamp)

            expect(m!.labels).not.toHaveProperty('user')
            expect(Object.values(m!.labels!)).not.toContain('user-public-1')
        })

        it('correlate: false drops every identity field', () => {
            const m = buildMetric('app.thing', 'counter', 1, { time: 1000, correlate: false }, fullStamp)

            expect(m!.trace).toBeUndefined()
            expect(m!.session).toBeUndefined()
            expect(m!.user).toBeUndefined()
            expect(m!.labels).toBeUndefined()
        })

        it('correlate: false still keeps explicitly-passed labels', () => {
            const m = buildMetric('app.thing', 'counter', 1, {
                time: 1000,
                correlate: false,
                labels: { op: 'select' },
            }, fullStamp)

            expect(m!.labels).toEqual({ op: 'select' })
        })
    })
})
