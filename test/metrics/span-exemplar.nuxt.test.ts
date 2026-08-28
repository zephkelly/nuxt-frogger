// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const { useRuntimeConfigMock, enqueueLog } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(() => ({
        frogger: { batch: false, scrub: false, transports: [] },
        public: {
            frogger: {
                serverModule: true,
                app: 'test-app',
                endpoint: '',
                baseUrl: '',
                batch: false,
                scrub: false,
                spans: { level: 'info', metric: true },
            },
        },
    })),
    enqueueLog: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog, flush: vi.fn() }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'
import { setSpanMetricSink } from '../../src/runtime/shared/utils/span-metric-sink'
import type { SpanExemplar } from '../../src/runtime/shared/utils/span-metric-sink'

interface Recorded { name: string; trace?: SpanExemplar }

let recorded: Recorded[]

beforeEach(() => {
    recorded = []
    enqueueLog.mockClear()
    setSpanMetricSink((name, _duration, _ok, _labels, trace) => {
        recorded.push({ name, trace })
    })
})

afterEach(() => {
    setSpanMetricSink(null)
})

describe('span.duration exemplars', () => {
    it('points at the span being measured, not the ambient one', async () => {
        const logger = new ServerFroggerLogger({})

        await logger.span('outer', async () => {
            await logger.span('inner', async () => {})
        })

        const outer = recorded.find(r => r.name === 'outer')!
        const inner = recorded.find(r => r.name === 'inner')!

        expect(outer.trace).toBeDefined()
        expect(inner.trace).toBeDefined()
        // The regression: the sink fires after the span's context scope has
        // exited, so an ambient lookup gave the inner span the outer's id.
        expect(inner.trace!.spanId).not.toBe(outer.trace!.spanId)
    })

    it('keeps both spans on the same trace', async () => {
        const logger = new ServerFroggerLogger({})

        await logger.span('outer', async () => {
            await logger.span('inner', async () => {})
        })

        const traces = new Set(recorded.map(r => r.trace?.traceId))
        expect(traces.size).toBe(1)
    })

    it('carries an exemplar for a failed span too', async () => {
        const logger = new ServerFroggerLogger({})

        await expect(logger.span('boom', async () => {
            throw new Error('nope')
        })).rejects.toThrow('nope')

        expect(recorded).toHaveLength(1)
        expect(recorded[0]!.trace?.traceId).toBeTruthy()
    })
})
