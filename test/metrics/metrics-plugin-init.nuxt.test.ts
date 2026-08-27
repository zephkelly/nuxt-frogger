// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const { useRuntimeConfigMock, useNuxtAppMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    useNuxtAppMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)

import metricsPlugin from '../../src/runtime/metrics/app/plugins/metrics.client'

/** Minimal Nuxt-app double with a working hook/callHook pair. */
function makeNuxtApp() {
    const handlers: Record<string, Function[]> = {}
    return {
        hook(name: string, fn: Function) { (handlers[name] ||= []).push(fn) },
        callHook(name: string, ...args: unknown[]) {
            for (const h of handlers[name] || []) h(...args)
            return Promise.resolve()
        },
    } as Record<string, any>
}

function setConfig() {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                app: 'test-app',
                baseUrl: '',
                metrics: {
                    endpoint: '/api/_frogger/metrics',
                    webVitals: { reportAllChanges: false },
                    deviceStats: true,
                    sampleRate: 1,
                    maxEventsPerPage: 500,
                    batch: { maxSize: 100, maxAge: 5000 },
                },
            },
        },
    })
}

beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
})

afterEach(() => {
    useRuntimeConfigMock.mockReset()
    useNuxtAppMock.mockReset()
    vi.unstubAllGlobals()
    try {
        sessionStorage.clear()
    }
    catch {
        // sessionStorage unavailable in this env — nothing to clear.
    }
})

describe('metrics client plugin boot', () => {
    it('does NOT fire the one-shot frogger:init hook during plugin setup', async () => {
        setConfig()

        const nuxtApp = makeNuxtApp()
        useNuxtAppMock.mockReturnValue(nuxtApp)

        let initFired = false
        nuxtApp.hook('frogger:init', () => { initFired = true })

        // defineNuxtPlugin's object syntax returns a callable wrapper that
        // invokes setup(nuxtApp).
        await (metricsPlugin as unknown as (app: unknown) => unknown)(nuxtApp)

        // The page trace must be resolved lazily on the first vital — an eager
        // getAmbientClientLogger() in setup() would consume frogger:init before
        // any user plugin (registered after module plugins) could hook it.
        expect(initFired).toBe(false)
    })
})
