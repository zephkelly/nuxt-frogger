import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ModuleOptions } from '../src/runtime/shared/types/module-options'

/**
 * A setup harness for `src/module.ts`.
 *
 * This is the only thing that catches an option silently ceasing to register a
 * handler, plugin or import - the class of defect that produced a documented
 * `public.serverModule` option no code ever read. It runs `setup()` against a
 * stubbed `@nuxt/kit` and asserts what was registered for a given options
 * object, so it must stay ahead of anything that adds branches to that file.
 */
const kit = vi.hoisted(() => ({
    addPlugin: vi.fn(),
    addServerPlugin: vi.fn(),
    addImportsDir: vi.fn(),
    addServerImports: vi.fn(),
    addServerHandler: vi.fn(),
    addImports: vi.fn(),
    updateRuntimeConfig: vi.fn(),
    createResolver: vi.fn(() => ({ resolve: (p: string) => p })),
}))

vi.mock('@nuxt/kit', () => ({
    ...kit,
    // The module's default export is the object literal passed to
    // defineNuxtModule, so setup() can be invoked directly.
    defineNuxtModule: (definition: unknown) => definition,
}))

vi.mock('../src/runtime/shared/utils/frogger-config', () => ({
    loadFroggerConfig: vi.fn(async () => undefined),
}))

import froggerModule from '../src/module'

interface StubNuxt {
    options: Record<string, unknown>
    hooks: Record<string, ((...args: unknown[]) => unknown)[]>
    hook: (name: string, fn: (...args: unknown[]) => unknown) => void
    callHook: (name: string, ...args: unknown[]) => void
}

function stubNuxt(overrides: Record<string, unknown> = {}): StubNuxt {
    const hooks: StubNuxt['hooks'] = {}
    return {
        options: {
            dev: false,
            rootDir: '/app',
            alias: {},
            app: { baseURL: '/' },
            ...overrides,
        },
        hooks,
        hook(name, fn) {
            (hooks[name] ??= []).push(fn)
        },
        callHook: vi.fn(),
    }
}

async function setup(options: ModuleOptions = {}, nuxtOverrides: Record<string, unknown> = {}) {
    const nuxt = stubNuxt(nuxtOverrides)
    const setupFn = (froggerModule as unknown as { setup: (o: ModuleOptions, n: StubNuxt) => Promise<void> }).setup
    await setupFn(options, nuxt)
    return nuxt
}

const registered = (mock: { mock: { calls: unknown[][] } }): string[] =>
    mock.mock.calls.flatMap(call => {
        const arg = call[0]
        if (typeof arg === 'string') return [arg]
        if (Array.isArray(arg)) return arg.map((e: { name?: string; from?: string }) => e.name ?? e.from ?? '')
        if (arg && typeof arg === 'object') {
            const entry = arg as { name?: string; route?: string; from?: string }
            return [entry.route ?? entry.name ?? entry.from ?? '']
        }
        return []
    })

function runtimeConfig() {
    const last = kit.updateRuntimeConfig.mock.calls.at(-1)?.[0] as {
        public: { frogger: Record<string, unknown> }
        frogger: Record<string, unknown>
    }
    return last
}

beforeEach(() => {
    for (const fn of Object.values(kit)) {
        if (typeof fn === 'function' && 'mockClear' in fn) (fn as { mockClear: () => void }).mockClear()
    }
    kit.createResolver.mockReturnValue({ resolve: (p: string) => p })
})

describe('module setup: default install', () => {
    it('registers the ingest route, both server plugins and the client log queue', async () => {
        await setup()

        expect(registered(kit.addServerHandler)).toContain('/api/_frogger/logs')
        expect(registered(kit.addServerPlugin)).toEqual(
            expect.arrayContaining([
                './runtime/server/plugins/log-queue.server',
                './runtime/server/plugins/trace-headers.server',
            ]),
        )
        expect(registered(kit.addPlugin)).toContain('./runtime/app/plugins/log-queue.client')
    })

    it('registers exactly one getFrogger auto-import', async () => {
        await setup()

        const getFroggerEntries = kit.addServerImports.mock.calls
            .flatMap(call => call[0] as { name: string; from: string }[])
            .filter(entry => entry.name === 'getFrogger')

        expect(getFroggerEntries).toHaveLength(1)
        expect(getFroggerEntries[0]!.from).toBe('./runtime/server/utils/get-frogger')
    })

    it('does not register any metrics wiring when metrics are off', async () => {
        await setup()

        expect(registered(kit.addServerHandler)).not.toContain('/api/_frogger/metrics')
        expect(registered(kit.addPlugin)).not.toContain('./runtime/metrics/app/plugins/metrics.client')
        expect(registered(kit.addServerImports)).not.toContain('froggerMetrics')
        expect(runtimeConfig().public.frogger.metrics).toBeUndefined()
        expect(runtimeConfig().frogger.metrics).toBeUndefined()
    })

    it('does not register error capture on either side by default', async () => {
        await setup()

        expect(registered(kit.addServerPlugin)).not.toContain('./runtime/server/plugins/global-error.server')
        expect(registered(kit.addPlugin)).not.toContain('./runtime/app/plugins/global-vue-errors')
    })

    it('does not register the dev websocket route', async () => {
        await setup()
        expect(registered(kit.addServerHandler)).not.toContain('/api/_frogger/dev-ws')
    })
})

describe('module setup: option branches', () => {
    it('serverModule:false registers no server handler or plugin', async () => {
        await setup({ serverModule: false })

        expect(kit.addServerHandler).not.toHaveBeenCalled()
        expect(kit.addServerPlugin).not.toHaveBeenCalled()
        expect(registered(kit.addPlugin)).toContain('./runtime/app/plugins/log-queue.client')
    })

    it('clientModule:false registers no client plugin or composable', async () => {
        await setup({ clientModule: false })

        expect(kit.addPlugin).not.toHaveBeenCalled()
        expect(kit.addImports).not.toHaveBeenCalled()
    })

    it('throws when both runtimes are disabled', async () => {
        await expect(setup({ serverModule: false, clientModule: false })).rejects.toThrow(/at least one/i)
    })

    it('preset standard registers error capture on both sides', async () => {
        await setup({ preset: 'standard' })

        expect(registered(kit.addServerPlugin)).toContain('./runtime/server/plugins/global-error.server')
        expect(registered(kit.addPlugin)).toContain('./runtime/app/plugins/global-vue-errors')
    })

    it('metrics:true registers the route, plugins and both auto-imports', async () => {
        await setup({ metrics: true })

        expect(registered(kit.addServerHandler)).toContain('/api/_frogger/metrics')
        expect(registered(kit.addServerPlugin)).toContain('./runtime/metrics/server/plugins/metrics-queue.server')
        expect(registered(kit.addPlugin)).toContain('./runtime/metrics/app/plugins/metrics.client')
        expect(registered(kit.addImports)).toEqual(
            expect.arrayContaining(['froggerMetrics', 'setFroggerMetricsUser']),
        )
        expect(registered(kit.addServerImports)).toContain('froggerMetrics')
    })

    it('metrics with endpoint:false registers the queue but no ingest route', async () => {
        await setup({ metrics: { public: { endpoint: false } } })

        expect(registered(kit.addServerHandler)).not.toContain('/api/_frogger/metrics')
        expect(registered(kit.addServerPlugin)).toContain('./runtime/metrics/server/plugins/metrics-queue.server')
    })

    it('registers the dev websocket route only in dev', async () => {
        const prod = await setup({ websocket: true })
        expect(registered(kit.addServerHandler)).not.toContain('/api/_frogger/dev-ws')
        expect(prod).toBeTruthy()

        kit.addServerHandler.mockClear()
        await setup({ websocket: true }, { dev: true })
        expect(registered(kit.addServerHandler)).toContain('/api/_frogger/dev-ws')
    })

    it('advertises the websocket route to the client only when enabled', async () => {
        await setup()
        expect(runtimeConfig().public.frogger.websocket).toBeUndefined()

        await setup({ websocket: true })
        expect(runtimeConfig().public.frogger.websocket).toMatchObject({ route: '/api/_frogger/dev-ws' })
    })
})

describe('module setup: runtime config contract', () => {
    it('publishes the resolved resource block to both halves', async () => {
        await setup({ app: { name: 'shop', version: '2.0.0' }, environment: 'staging' })

        const expected = {
            'service.name': 'shop',
            'service.version': '2.0.0',
            'service.release': '2.0.0',
            'deployment.environment': 'staging',
        }
        expect(runtimeConfig().public.frogger.resource).toEqual(expected)
        expect(runtimeConfig().frogger.resource).toEqual(expected)
    })

    it('keeps server transports out of the public half', async () => {
        await setup({
            transports: [{ type: 'http', url: 'https://ingest.example.com/logs', apiKey: 'secret' }],
        })

        expect(runtimeConfig().frogger.transports).toHaveLength(1)
        expect(runtimeConfig().public.frogger.transports).toHaveLength(0)
    })

    it('puts a client:true transport in the public half', async () => {
        await setup({
            transports: [{ type: 'http', url: 'https://ingest.example.com/logs', client: true }],
        })

        expect(runtimeConfig().public.frogger.transports).toHaveLength(1)
    })
})

describe('module setup: build-time guards', () => {
    async function runBuildHook(options: ModuleOptions, nitro: unknown) {
        const nuxt = await setup(options)
        const hooks = nuxt.hooks['nitro:build:before'] ?? []
        for (const hook of hooks) await hook(nitro)
    }

    it('fails the build for a file transport on a preset with no filesystem', async () => {
        await expect(
            runBuildHook(
                { transports: [{ type: 'file' }] },
                { options: { preset: 'cloudflare-module' } },
            ),
        ).rejects.toThrow(/fileTransport/)
    })

    it('allows a file transport on a node preset', async () => {
        await expect(
            runBuildHook({ transports: [{ type: 'file' }] }, { options: { preset: 'node-server' } }),
        ).resolves.toBeUndefined()
    })

    it('warns about a bundle-visible apiKey even at the production log level', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await runBuildHook(
            {
                logLevel: 'silent',
                transports: [{ type: 'http', url: 'https://ingest.example.com/logs', client: true, apiKey: 'leaked' }],
            },
            { options: { preset: 'node-server' } },
        )

        // Ungated on purpose: the production build is the one that ships the key.
        expect(warn.mock.calls.some(c => c.join(' ').includes('public browser bundle'))).toBe(true)
        warn.mockRestore()
    })

    it('stays silent about the apiKey when publicKeyOk is declared', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await runBuildHook(
            { transports: [{ type: 'observe', url: 'https://observe.example.com', key: 'pub', client: true }] },
            { options: { preset: 'node-server' } },
        )

        expect(warn.mock.calls.some(c => c.join(' ').includes('public browser bundle'))).toBe(false)
        warn.mockRestore()
    })

    it('warns when scrubbing is on but resolves to zero rules', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await runBuildHook({ logLevel: 'silent', scrub: true }, { options: { preset: 'node-server' } })

        expect(warn.mock.calls.some(c => c.join(' ').includes('no rules are configured'))).toBe(true)
        warn.mockRestore()
    })

    it('stays silent when a preset supplies the rules it promises', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await runBuildHook({ logLevel: 'silent', preset: 'standard' }, { options: { preset: 'node-server' } })

        expect(warn.mock.calls.some(c => c.join(' ').includes('no rules are configured'))).toBe(false)
        warn.mockRestore()
    })
})
