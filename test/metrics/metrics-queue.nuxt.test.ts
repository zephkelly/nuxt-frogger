// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

import type { MetricObject } from '../../src/runtime/metrics/shared/types/metric'

const { useRuntimeConfigMock } = vi.hoisted(() => ({ useRuntimeConfigMock: vi.fn() }))
mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

import { MetricsQueueService } from '../../src/runtime/metrics/app/services/metrics-queue'

function metric(overrides: Partial<MetricObject> = {}): MetricObject {
    return { time: 0, name: 'web.vital.lcp', kind: 'gauge', value: 1, env: 'client', ...overrides }
}

function setConfig(metrics: Record<string, unknown>) {
    useRuntimeConfigMock.mockReturnValue({
        public: { frogger: { app: 'test-app', baseUrl: '', metrics } },
    })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
    useRuntimeConfigMock.mockReset()
    vi.unstubAllGlobals()
})

describe('MetricsQueueService', () => {
    it('sends immediately when batching is off', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0]!
        expect(url).toBe('/api/_frogger/metrics')
        expect((opts as any).body.metrics).toHaveLength(1)
    })

    it('enforces the per-page cap and drops the overflow', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 2 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: true })

        q.enqueueMetric(metric())
        q.enqueueMetric(metric())
        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('collects nothing for a sampled-out session', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 's', sampled: false })

        expect(q.isSampled()).toBe(false)
        q.enqueueMetric(metric())
        await Promise.resolve()

        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stamps the batch envelope with app, context and session', async () => {
        setConfig({ endpoint: '/api/_frogger/metrics', batch: false, maxEventsPerPage: 500 })
        const q = new MetricsQueueService()
        q.setSession({ id: 'sess-1', sampled: true })
        q.setContext({ effectiveType: '4g' })

        q.enqueueMetric(metric())
        await Promise.resolve()

        const body = (fetchMock.mock.calls[0]![1] as any).body
        expect(body.session).toEqual({ id: 'sess-1', sampled: true })
        expect(body.context).toEqual({ effectiveType: '4g' })
        expect(body.app.name).toBe('test-app')
    })
})
