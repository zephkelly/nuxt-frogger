// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const { useRuntimeConfigMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)

import { getLogQueue } from '../../src/runtime/app/services/get-log-queue'
import { LogQueueService } from '../../src/runtime/app/services/log-queue'

beforeEach(() => {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                serverModule: false,
                app: 'test-app',
                endpoint: '/api/_frogger/logs',
                baseUrl: '',
                batch: { maxSize: 100, maxAge: 3000 },
                scrub: false,
                transports: [],
            },
        },
    })
})

afterEach(() => {
    useRuntimeConfigMock.mockReset()
})

describe('getLogQueue (lazy, injection-free resolution)', () => {
    it('creates a LogQueueService on first use even when no plugin has provided one', () => {
        // A bare app instance — nothing has run `provide('logQueue', ...)` yet.
        const nuxtApp = {} as Record<string, any>

        const queue = getLogQueue(nuxtApp)

        expect(queue).toBeInstanceOf(LogQueueService)
    })

    it('caches ONE instance per app (a second call returns the same queue)', () => {
        const nuxtApp = {} as Record<string, any>

        const first = getLogQueue(nuxtApp)
        const second = getLogQueue(nuxtApp)

        expect(second).toBe(first)
    })

    it('reuses a queue that a plugin already placed on the app', () => {
        const existing = new LogQueueService()
        const nuxtApp = { $logQueue: existing } as Record<string, any>

        expect(getLogQueue(nuxtApp)).toBe(existing)
    })

    it('scopes the queue per app instance (SSR: one nuxtApp per request)', () => {
        const appA = {} as Record<string, any>
        const appB = {} as Record<string, any>

        expect(getLogQueue(appA)).not.toBe(getLogQueue(appB))
    })
})
