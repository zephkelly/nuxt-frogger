import {
    defineNuxtModule,
    addPlugin,
    createResolver,
    addServerPlugin,
    addImportsDir,
    addServerImports,
    addServerHandler,
    updateRuntimeConfig,
    addImports,
} from '@nuxt/kit'

import { defu } from 'defu'

import { DEFAULT_LOGGING_ENDPOINT } from './runtime/shared/types/module-options'

import type { ModuleOptions } from './runtime/shared/types/module-options'
import { loadFroggerConfig } from './runtime/shared/utils/frogger-config'
import { resolveFroggerOptions } from './runtime/shared/utils/resolve-options'
import { resolveInternalLogLevel, type InternalLogLevel } from './runtime/shared/utils/internal-log'

// Re-export the declarative transport factories + config types so nuxt.config
// users can `import { fileTransport } from 'nuxt-frogger'`. frogger.config.ts
// users import the same names from '#frogger/config' (runtime/options.ts).
export {
    fileTransport,
    httpTransport,
    observeTransport,
} from './runtime/shared/transports/factories'
export type {
    FroggerTransportConfig,
    FileTransportConfig,
    HttpTransportConfig,
    ObserveTransportConfig,
} from './runtime/shared/types/transports'

// Mirror of the level ordering in internal-log.ts so build-time banner gating
// can compare thresholds without importing runtime mutable state.
const INTERNAL_LEVEL_WEIGHT: Record<InternalLogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
}



export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-frogger',
        configKey: 'frogger',
    },
    // Frogger owns ALL of its defaults in `resolveFroggerOptions`
    // (runtime/shared/utils/resolve-options.ts). This block is intentionally
    // empty: if it pre-filled subsystem keys, @nuxt/kit would merge them into
    // `_options` before setup() runs, and we could no longer distinguish a
    // user-set option from a default — which the preset / opt-in precedence
    // depends on.
    defaults: {},
    async setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        // Provide #frogger import alias
        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger/config'] = resolver.resolve('./runtime/options');


        // Load configuration from frogger.config.ts / .js (wins over the
        // nuxt.config `frogger` key), then expand presets + opt-in toggles into
        // a fully-normalised config.
        const froggerConfig = await loadFroggerConfig(_nuxt.options.rootDir);
        const userOptions: ModuleOptions = froggerConfig
            ? defu(froggerConfig, _options) as ModuleOptions
            : _options;

        const resolved = resolveFroggerOptions(userOptions);

        if (resolved.serverModule === false && resolved.clientModule === false) {
            throw new Error('🐸FROGGER: `serverModule` and `clientModule` are both set to `false`. At least one is required to use Frogger.');
        }

        const serverModuleEnabled = resolved.serverModule !== false;
        const autoEventCapture = typeof resolved.serverModule === 'object'
            ? resolved.serverModule.autoEventCapture !== false
            : resolved.serverModule === true;

        // Resolve how loud Frogger is allowed to be about itself (build banners
        // here, internal runtime diagnostics via runtime config below).
        const internalLogLevel = resolveInternalLogLevel(
            resolved.verbose,
            resolved.logLevel,
            _nuxt.options.dev,
        );
        const internalLevelWeight = INTERNAL_LEVEL_WEIGHT[internalLogLevel];
        const allowInternal = (level: InternalLogLevel) =>
            internalLevelWeight >= INTERNAL_LEVEL_WEIGHT[level];


        // The client only needs to know the websocket route when the live-stream
        // is actually enabled; otherwise we don't advertise one.
        const publicWebsocket = resolved.websocket
            ? {
                route: resolved.websocket.route,
                defaultChannel: resolved.websocket.defaultChannel ?? 'main',
            }
            : undefined;


        // Set runtime config
        const moduleRuntimeConfig = {
            public: {
                frogger: {
                    app: resolved.app,
                    logLevel: internalLogLevel,
                    clientModule: resolved.clientModule,
                    serverModule: serverModuleEnabled,
                    endpoint: resolved.public.endpoint,
                    baseUrl: resolved.public.baseUrl || _nuxt.options.app.baseURL,
                    batch: resolved.public.batch,
                    scrub: resolved.scrub,
                    websocket: publicWebsocket,
                    errorCapture: resolved.errorCapture.client,
                    // ⚠️ apiKeys on client transports are bundle-visible.
                    transports: resolved.transports.client,
                },
            },
            frogger: {
                serverModule: resolved.serverModule,
                logLevel: internalLogLevel,

                // Server-only (mixed file + http union): keys stay out of the
                // client bundle. File logging is just a `fileTransport()` entry.
                transports: resolved.transports.server,

                batch: resolved.batch,
                rateLimit: resolved.rateLimit,
                websocket: resolved.websocket,
                scrub: resolved.scrub,
                errorCapture: resolved.errorCapture.server,
            }
        };

        updateRuntimeConfig(moduleRuntimeConfig)


        _nuxt.hook('nitro:config', async (nitroConfig: any) => {
            nitroConfig.experimental = nitroConfig.experimental || {}

            nitroConfig.experimental.tasks = true
            nitroConfig.experimental.asyncContext = true

            if (serverModuleEnabled) {
                if (resolved.websocket) {
                    nitroConfig.experimental.websocket = true;
                }

                nitroConfig.experimental.asyncContext = autoEventCapture;
            }
        })

        _nuxt.hook('nitro:build:before', () => {
            // Genuine misconfiguration warning (shown at warn level and above —
            // i.e. in dev by default, suppressed in production unless opted in).
            // Skipped when the app deliberately fans out to a client transport
            // instead of its own backend (e.g. a static app → observe direct).
            if (
                allowInternal('warn')
                && !serverModuleEnabled
                && resolved.public.endpoint === DEFAULT_LOGGING_ENDPOINT
                && resolved.transports.client.length === 0
            ) {
                console.warn(
                    '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                    `You are using Frogger with \x1b[36mserverModule\x1b[0m set to \x1b[36mfalse\x1b[0m and no \x1b[36mpublic.endpoint\x1b[0m
                set in your \x1b[36mfrogger.config.ts\x1b[0m. Your logs will never leave the client!`
                );
            }

            // Client transports are compiled into the public bundle — any
            // apiKey on one is therefore NOT a secret. Warn (once per keyed
            // transport) so the author knows before it ships. observe browser
            // keys are write-only public by design (`publicKeyOk`) — skipped.
            if (allowInternal('warn')) {
                for (const t of resolved.transports.client) {
                    if (t.apiKey && !t.publicKeyOk) {
                        console.warn(
                            '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                            `Client transport \x1b[36m${t.name}\x1b[0m carries an \x1b[36mapiKey\x1b[0m that will be `
                            + `compiled into the public browser bundle. Only use a write-only, per-service, `
                            + `rate-limited ingest key here — never a read/admin key.`
                        );
                    }
                }
            }

            // No persistent transport configured → logs reach console only and
            // are never persisted. One-time dev nudge toward an explicit sink.
            if (
                allowInternal('warn')
                && resolved.transports.server.length === 0
                && resolved.transports.client.length === 0
            ) {
                console.warn(
                    '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                    `No persistent transport is configured — logs go to the \x1b[36mconsole\x1b[0m only and are not persisted. `
                    + `Add \x1b[36mfileTransport()\x1b[0m for local files, or \x1b[36mobserveTransport()\x1b[0m / \x1b[36mhttpTransport()\x1b[0m `
                    + `to forward them. Ignore this if you register a transport imperatively via \x1b[36maddGlobalTransport()\x1b[0m.`
                );
            }

            // The single concise "ready" line: dev only, suppressed entirely at
            // silent level. Production builds print nothing.
            if (_nuxt.options.dev && internalLogLevel !== 'silent' && (serverModuleEnabled || resolved.clientModule)) {
                console.log(
                    '🐸 \x1b[32mFROGGER\x1b[0m',
                    `Ready to log`
                );

                // Scrubbing is fully opt-in: enabling it does not add any rules.
                // Surface the active rule count so `0 rules active` is visible
                // rather than silently doing nothing.
                if (resolved.scrub) {
                    const ruleCount = resolved.scrub.rules?.length ?? 0;
                    console.log(
                        '🐸 \x1b[32mFROGGER\x1b[0m',
                        `scrubbing enabled: ${ruleCount} rule${ruleCount === 1 ? '' : 's'} active`
                    );
                }
            }
        })

        if (_nuxt.options.dev) {
            const possibleConfigPaths = [
                'frogger.config.ts',
                'frogger.config.js',
            ];

            _nuxt.hook('builder:watch', (event, path) => {
                if (event === 'change' && possibleConfigPaths.includes(path)) {
                    if (allowInternal('info')) {
                        console.log(
                            '\x1b[36mℹ\x1b[0m frogger.config.ts updated. Restarting Nuxt...'
                        );
                    }

                    _nuxt.callHook('restart', { hard: true });
                }
            });
        }


        if (resolved.clientModule) {
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');

            // Composables
            const clientComposables = [{
                name: 'useFrogger',
                from: resolver.resolve('./runtime/app/composables/useFrogger')
            }, {
                // Zero-ceremony ambient logger (drop-in for console.*)
                name: 'frogger',
                from: resolver.resolve('./runtime/app/frogger')
            }]
            if (resolved.websocket && serverModuleEnabled) {
                clientComposables.push({
                    name: 'useFroggerWebSocket',
                    from: resolver.resolve('./runtime/app/composables/useFroggerWebSocket')
                })
            }
            addImports(clientComposables)

            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addPlugin(resolver.resolve('./runtime/app/plugins/log-queue.client'))

            if (resolved.errorCapture.client) {
                if (allowInternal('info')) {
                    console.log('🐸 FROGGER: Setting up Vue global error capture');
                }
                addPlugin(resolver.resolve('./runtime/app/plugins/global-vue-errors'))
            }
        }

        if (serverModuleEnabled) {
            _nuxt.options.alias['#frogger/server'] = resolver.resolve('./runtime/server');

            if (autoEventCapture) {
                addServerImports([
                    {
                        name: 'getFrogger',
                        from: resolver.resolve('./runtime/server/utils/auto')
                    }
                ])
            }
            else {
                addServerImports([
                    {
                        name: 'getFrogger',
                        from: resolver.resolve('./runtime/server/utils/manual')
                    }
                ])
            }

            addServerImports([
                {
                    name: 'HttpTransport',
                    from: resolver.resolve('./runtime/logger/_transports/http-transport')
                },
                {
                    // Zero-ceremony ambient logger (drop-in for console.*)
                    name: 'frogger',
                    from: resolver.resolve('./runtime/server/utils/frogger')
                }
            ])

            addServerPlugin(resolver.resolve('./runtime/server/plugins/log-queue.server'))
            addServerPlugin(resolver.resolve('./runtime/server/plugins/trace-headers.server'))

            addServerHandler({
                route: '/api/_frogger/logs',
                handler: resolver.resolve('./runtime/server/api/logger.post'),
            })

            if (resolved.websocket && _nuxt.options.dev) {
                const wsRoute = resolved.websocket.route || '/api/_frogger/dev-ws';

                if (wsRoute !== '/api/_frogger/dev-ws' && allowInternal('info')) {
                    console.log(
                        '🐸 \x1b[32mFROGGER\x1b[0m',
                        `Using custom WebSocket route: \x1b[36m${wsRoute}\x1b[0m`
                    );
                }

                addServerHandler({
                    route: wsRoute,
                    handler: resolver.resolve('./runtime/server/api/dev-websocket-handler'),
                })
            }

            if (resolved.errorCapture.server) {
                if (allowInternal('info')) {
                    console.log('🐸 FROGGER: Setting up Nitro global error capture');
                }
                addServerPlugin(resolver.resolve('./runtime/server/plugins/global-error.server'))
            }
        }
    },
})
