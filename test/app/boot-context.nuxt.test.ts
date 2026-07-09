// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

const { useRuntimeConfigMock, useNuxtAppMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    useNuxtAppMock: vi.fn(),
}))

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)
mockNuxtImport('useState', () => <T>(_key: string, init?: () => T) => ref(init ? init() : undefined))

import { getAmbientClientLogger } from '../../src/runtime/app/frogger'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

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

function setConfig(context?: Record<string, unknown>) {
    useRuntimeConfigMock.mockReturnValue({
        public: {
            frogger: {
                serverModule: false,
                app: 'test-app',
                endpoint: '/api/_frogger/logs',
                baseUrl: '',
                batch: false,
                scrub: false,
                transports: [],
                context,
            },
        },
    })
}

/** Capture the LoggerObject that an ambient log produces via a reporter. */
function capture(logger: IFroggerLogger, fn: () => void): Promise<LoggerObject> {
    return new Promise((resolve) => {
        logger.addReporter({ log: (o: LoggerObject) => resolve(o) })
        fn()
    })
}

beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useRuntimeConfigMock.mockReset()
    useNuxtAppMock.mockReset()
})

describe('ambient boot-context', () => {
    it('stamps static config context onto every ambient log with zero user plugin', async () => {
        setConfig({ service: 'checkout', region: 'us-east' })
        useNuxtAppMock.mockReturnValue(makeNuxtApp())

        const logger = getAmbientClientLogger()
        const record = await capture(logger, () => logger.info('hi'))

        expect(record.ctx).toMatchObject({ service: 'checkout', region: 'us-east' })
    })

    it('fires the frogger:init hook with the ambient logger before the first log', async () => {
        setConfig()
        const nuxtApp = makeNuxtApp()
        useNuxtAppMock.mockReturnValue(nuxtApp)

        // Register the hook the way a user plugin would, BEFORE any log.
        nuxtApp.hook('frogger:init', (f: IFroggerLogger) => {
            f.addContext({ tenant: 'acme' })
        })

        const logger = getAmbientClientLogger()
        const record = await capture(logger, () => logger.info('hi'))

        expect(record.ctx).toMatchObject({ tenant: 'acme' })
    })

    it('composes static config context with runtime hook context', async () => {
        setConfig({ service: 'checkout' })
        const nuxtApp = makeNuxtApp()
        useNuxtAppMock.mockReturnValue(nuxtApp)
        nuxtApp.hook('frogger:init', (f: IFroggerLogger) => f.addContext({ tenant: 'acme' }))

        const logger = getAmbientClientLogger()
        const record = await capture(logger, () => logger.info('hi'))

        expect(record.ctx).toMatchObject({ service: 'checkout', tenant: 'acme' })
    })

    it('fires frogger:init exactly once even though the logger is resolved many times', async () => {
        setConfig()
        const nuxtApp = makeNuxtApp()
        useNuxtAppMock.mockReturnValue(nuxtApp)
        const handler = vi.fn()
        nuxtApp.hook('frogger:init', handler)

        getAmbientClientLogger()
        getAmbientClientLogger()
        getAmbientClientLogger()

        expect(handler).toHaveBeenCalledTimes(1)
    })
})
