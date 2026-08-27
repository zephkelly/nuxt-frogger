import { describe, it, expect } from 'vitest'

import {
    metricFileTransport,
    metricMemoryTransport,
    metricObserveTransport,
} from '../../src/runtime/metrics/shared/transports/factories'

describe('metric transport factories', () => {
    it('metricFileTransport tags type:file and carries options', () => {
        expect(metricFileTransport()).toEqual({ type: 'file' })
        expect(metricFileTransport({ directory: 'var/metrics', name: 'disk' })).toEqual({
            type: 'file', directory: 'var/metrics', name: 'disk',
        })
    })

    it('metricMemoryTransport tags type:memory and carries options', () => {
        expect(metricMemoryTransport({ name: 'test' })).toEqual({ type: 'memory', name: 'test' })
    })

    it('metricObserveTransport tags type:observe and carries options', () => {
        expect(metricObserveTransport({ url: 'https://observe.app.com', key: 'k', client: true })).toEqual({
            type: 'observe', url: 'https://observe.app.com', key: 'k', client: true,
        })
    })

    it('returns plain serializable objects that survive structuredClone', () => {
        const entries = [
            metricFileTransport({ directory: 'logs/metrics' }),
            metricMemoryTransport({ name: 'x' }),
            metricObserveTransport({ url: 'https://observe.app.com', key: 'k' }),
        ]
        for (const entry of entries) {
            const cloned = structuredClone(entry)
            expect(cloned).toEqual(entry)
            expect(cloned).not.toBe(entry)
        }
    })
})
