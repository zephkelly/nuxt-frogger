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

import { DEFAULT_METRICS_ENDPOINT } from './runtime/shared/types/module-options'
import { hasPrimaryLogSink } from './runtime/shared/utils/primary-sink'
import { resolveBuildResource } from './runtime/shared/utils/resolve-resource'
import { parseAppInfoConfig } from './runtime/app-info/parse'

import type { ModuleOptions } from './runtime/shared/types/module-options'
import type {
    FroggerPublicRuntimeConfig,
    FroggerServerRuntimeConfig,
} from './runtime/shared/types/runtime-config'
import { loadFroggerConfig } from './runtime/shared/utils/frogger-config'
import { resolveFroggerOptions } from './runtime/shared/utils/resolve-options'
import { resolveInternalLogLevel, type InternalLogLevel } from './runtime/shared/utils/internal-log'

// Re-export the declarative transport factories + config types so nuxt.config
// users can `import { fileTransport } from 'nuxt-frogger'`. frogger.config.ts
// users import the same names from '#frogger/config' (runtime/options.ts).
export {
    fileTransport,
    httpTransport,
    stdoutTransport,
    observeTransport,
    memoryTransport,
} from './runtime/shared/transports/factories'
export type {
    FroggerTransportConfig,
    FileTransportConfig,
    HttpTransportConfig,
    StdoutTransportConfig,
    ObserveTransportConfig,
    MemoryTransportConfig,
    TransportMinLevel,
} from './runtime/shared/types/transports'

// The transport contract's TYPES only. The runtime values (`BaseTransport`,
// `addGlobalTransport`, `getFroggerHealth`) live behind the
// `nuxt-frogger/transport` subpath: re-exporting them here would pull the
// runtime - and its `#imports` dependencies, which do not exist at build
// time - into the build-time module graph.
export type { IFroggerTransport } from './runtime/logger/_transports/types'
export type { FroggerHealth, FroggerDropCounts } from './runtime/shared/utils/health'

// Metric-transport factories + config types (parallel to the log factories).
export {
    metricFileTransport,
    metricMemoryTransport,
    metricObserveTransport,
} from './runtime/metrics/shared/transports/factories'
export type {
    FroggerMetricTransportConfig,
    MetricFileTransportConfig,
    MetricMemoryTransportConfig,
    MetricObserveTransportConfig,
} from './runtime/metrics/shared/types/metric-transports'
export type { MetricsOptions } from './runtime/metrics/shared/types/metric-options'

// Presets that run on a long-lived Node process with a writable filesystem.
// Everything else (workers, edge runtimes, pure-static) cannot host a file
// transport. Matched loosely so unknown self-hosted node-* presets pass.
const NODE_COMPATIBLE_PRESETS = /^(node|nitro-dev|bun|deno-server|aws-lambda|azure-functions)/

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
        // Declared so an incompatible install fails at install time rather
        // than at first request. This also pins the Nitro hook availability the
        // per-request instrumentation depends on.
        compatibility: {
            nuxt: '^4.0.0',
        },
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

        // Metrics are a fully separate, opt-in subsystem. When off, NOTHING is
        // emitted: no plugin, no route, no runtime-config keys, no singleton —
        // fully inert like every other opt-in subsystem.
        const metrics = resolved.metrics;
        const metricsEnabled = metrics !== false;

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


        // Deployment identity, resolved once here and serialised into both
        // halves of runtime config. `service.instance.id` is deliberately not
        // resolved at build time - it must be per boot, so the server adds it.
        const appInfo = parseAppInfoConfig(resolved.app);
        const resource = resolveBuildResource({
            appName: appInfo.name,
            appVersion: appInfo.version,
            environment: resolved.environment,
            dev: _nuxt.options.dev,
        });


        // The client only needs to know the websocket route when the live-stream
        // is actually enabled; otherwise we don't advertise one.
        const publicWebsocket = resolved.websocket
            ? {
                route: resolved.websocket.route,
                defaultChannel: resolved.websocket.defaultChannel ?? 'main',
            }
            : undefined;


        // Typed against the same declaration every runtime reader uses, so a
        // key written here and never read (or read and never written) is a
        // compile error rather than an `undefined` nobody notices.
        const moduleRuntimeConfig: {
            public: { frogger: FroggerPublicRuntimeConfig }
            frogger: FroggerServerRuntimeConfig
        } = {
            public: {
                frogger: {
                    app: resolved.app,
                    resource,
                    // The application-log threshold, per runtime. Public so the
                    // client logger can read its own side; distinct from
                    // `logLevel`, which is Frogger's internal diagnostics.
                    level: resolved.level,
                    context: resolved.context,
                    logLevel: internalLogLevel,
                    // Both sides live in public config: they are plain booleans,
                    // and the server logger already reads its scrub default from
                    // here, so a single key keeps the two runtimes from drifting.
                    consoleOutput: resolved.consoleOutput,
                    clientModule: resolved.clientModule,
                    serverModule: serverModuleEnabled,
                    endpoint: resolved.public.endpoint,
                    baseUrl: resolved.public.baseUrl || _nuxt.options.app.baseURL,
                    batch: resolved.public.batch,
                    // Both runtimes' loggers read span-event config from here.
                    spans: resolved.spans,
                    tracePropagation: resolved.tracePropagation,
                    scrub: resolved.scrub,
                    websocket: publicWebsocket,
                    errorCapture: resolved.errorCapture.client,
                    // ⚠️ apiKeys on client transports are bundle-visible.
                    transports: resolved.transports.client,
                    // Metrics client config — present ONLY when metrics are on.
                    ...(metricsEnabled ? {
                        metrics: {
                            endpoint: metrics.public.endpoint,
                            webVitals: metrics.webVitals,
                            deviceStats: metrics.deviceStats,
                            sampleRate: metrics.sampleRate,
                            maxEventsPerPage: metrics.maxEventsPerPage,
                            batch: metrics.public.batch,
                            transports: metrics.transports.client,
                        },
                    } : {}),
                },
            },
            frogger: {
                serverModule: resolved.serverModule,
                resource,
                context: resolved.context,
                logLevel: internalLogLevel,

                // Server-only (mixed file + http union): keys stay out of the
                // client bundle. File logging is just a `fileTransport()` entry.
                transports: resolved.transports.server,

                batch: resolved.batch,
                sampling: resolved.sampling,
                rateLimit: resolved.rateLimit,
                websocket: resolved.websocket,
                scrub: resolved.scrub,
                errorCapture: resolved.errorCapture.server,
                // Metrics server config (file/memory transports stay server-side).
                ...(metricsEnabled ? {
                    metrics: {
                        transports: metrics.transports.server,
                        batch: metrics.batch,
                        requests: metrics.requests,
                        runtime: metrics.runtime,
                    },
                } : {}),
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

        _nuxt.hook('nitro:build:before', (nitro: any) => {
            // A file transport needs a writable filesystem and a long-lived
            // process. On an edge/serverless preset it fails at first write with
            // no build-time signal at all, which is a silent loss of the primary
            // documented local-persistence path - so this errors rather than warns.
            const fileEntries = [
                ...resolved.transports.server.filter(t => t.type === 'file'),
                ...(metricsEnabled ? metrics.transports.server.filter(t => t.type === 'file') : []),
            ];
            const preset: string | undefined = nitro?.options?.preset;
            if (fileEntries.length > 0 && preset && !NODE_COMPATIBLE_PRESETS.test(preset)) {
                throw new Error(
                    `🐸FROGGER: a fileTransport() is configured but the Nitro preset is "${preset}", `
                    + `which has no writable filesystem. Use httpTransport() or observeTransport() to forward `
                    + `logs off the instance, or stdoutTransport() to emit JSON lines the platform collects.`,
                );
            }

            const publicEndpoint = resolved.public.endpoint;
            const publicBaseUrl = resolved.public.baseUrl;
            const serverTransports = resolved.transports.server;
            const clientTransports = resolved.transports.client;
            const transportNames = (ts: { name: string }[]) =>
                ts.map(t => `\x1b[36m${t.name}\x1b[0m`).join(', ');

            // The one shared predicate for "do client logs leave this app";
            // the batch queue and the immediate-send path defer to it too, so
            // the banner can never disagree with what the runtime does.
            const primarySink = hasPrimaryLogSink({
                serverModuleEnabled,
                endpoint: publicEndpoint,
                baseUrl: publicBaseUrl,
            });

            // Genuinely sinkless: nothing durable anywhere, warn (shown at warn
            // level and above, i.e. in dev by default, suppressed in production
            // unless opted in). A relay app (public.baseUrl set) or a custom
            // endpoint no longer trips this: its sink is the remote ingest.
            if (allowInternal('warn') && !primarySink && clientTransports.length === 0) {
                console.warn(
                    '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                    publicEndpoint === false
                        ? `\x1b[36mpublic.endpoint\x1b[0m is \x1b[36mfalse\x1b[0m and no client transport is configured: `
                        + `logs never leave the client. Add a client transport, or re-enable the endpoint.`
                        : `No log sink is configured: \x1b[36mserverModule\x1b[0m is \x1b[36mfalse\x1b[0m, `
                        + `\x1b[36mpublic.endpoint\x1b[0m is the default and \x1b[36mpublic.baseUrl\x1b[0m is unset, `
                        + `so logs never leave the client. Set \x1b[36mpublic.baseUrl\x1b[0m to your ingest app's origin, `
                        + `or add a client transport.`
                );
            }

            // Ingesting locally but nowhere durable downstream: console only.
            if (allowInternal('warn') && serverModuleEnabled && serverTransports.length === 0) {
                console.warn(
                    '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                    `Ingesting logs but no server transport is configured: logs stop at the \x1b[36mconsole\x1b[0m `
                    + `and are not persisted. Add \x1b[36mfileTransport()\x1b[0m for local files, or `
                    + `\x1b[36mobserveTransport()\x1b[0m / \x1b[36mhttpTransport()\x1b[0m to forward them. `
                    + `Ignore this if you register a transport imperatively via \x1b[36maddGlobalTransport()\x1b[0m.`
                );
            }

            // Client transports are compiled into the public bundle, so any
            // apiKey on one is NOT a secret. observe browser keys are
            // write-only public by design (`publicKeyOk`) and skipped; metric
            // client transports ship in the same bundle and get the same check.
            //
            // Deliberately NOT gated on the internal log level. The level
            // resolves to silent in production, which is exactly the build that
            // ships the key - so a gated warning is silent at the only moment
            // it matters.
            const bundledTransports = [
                ...clientTransports,
                ...(metricsEnabled ? metrics.transports.client : []),
            ];
            for (const t of bundledTransports) {
                if (t.apiKey && !t.publicKeyOk) {
                    console.warn(
                        '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                        `Client transport \x1b[36m${t.name}\x1b[0m carries an \x1b[36mapiKey\x1b[0m that will be `
                        + `compiled into the public browser bundle and is readable by every visitor. `
                        + `Move the transport server-side (drop \x1b[36mclient: true\x1b[0m), or - if this really is `
                        + `a write-only, per-service, rate-limited ingest key - set \x1b[36mpublicKeyOk: true\x1b[0m `
                        + `to record that you have verified it.`
                    );
                }
            }

            // The single concise "ready" line: dev only, suppressed entirely at
            // silent level. Production builds print nothing.
            if (_nuxt.options.dev && internalLogLevel !== 'silent' && (serverModuleEnabled || resolved.clientModule)) {
                console.log(
                    '🐸 \x1b[32mFROGGER\x1b[0m',
                    `Ready to log`
                );

                // One line stating the resolved delivery topology, so "where do
                // my logs actually go" is answered at boot instead of by
                // dumping runtime config. Mirrors `hasPrimaryLogSink` exactly.
                let summary: string | null = null;
                if (serverModuleEnabled) {
                    const ingest = publicEndpoint === false
                        ? `Client log POST disabled (\x1b[36mpublic.endpoint: false\x1b[0m)`
                        : `Ingesting client logs at \x1b[36m${publicEndpoint}\x1b[0m`;
                    if (serverTransports.length > 0) {
                        summary = `${ingest}; forwarding via ${serverTransports.length} server transport(s): ${transportNames(serverTransports)}`;
                    }
                    // Zero server transports already warned above; no summary line.
                }
                else if (primarySink && publicBaseUrl) {
                    summary = `Relaying client logs to \x1b[36m${publicBaseUrl}${publicEndpoint}\x1b[0m `
                        + `(emitter only: ingest, scrubbing and persistence run on the relay app)`;
                }
                else if (primarySink) {
                    summary = `Shipping client logs to \x1b[36m${publicEndpoint}\x1b[0m on this app's origin`;
                }
                else if (clientTransports.length > 0) {
                    summary = `Fanning client logs out to ${clientTransports.length} client transport(s): ${transportNames(clientTransports)}`;
                }
                if (summary && primarySink && clientTransports.length > 0) {
                    summary += `; also fanning out to ${clientTransports.length} client transport(s): ${transportNames(clientTransports)}`;
                }
                if (summary) {
                    console.log('🐸 \x1b[32mFROGGER\x1b[0m', summary);
                }

                // Surface the active rule count so the resolved rule set is
                // visible at a glance. The zero-rule case warns unconditionally
                // below, dev or not.
                if (resolved.scrub) {
                    const ruleCount = resolved.scrub.rules?.length ?? 0;
                    console.log(
                        '🐸 \x1b[32mFROGGER\x1b[0m',
                        `scrubbing enabled: ${ruleCount} rule${ruleCount === 1 ? '' : 's'} active`
                    );
                }
            }

            // A scrubber with no rules redacts nothing. Enabling scrubbing
            // deliberately does not inject rules, so this is reachable only by
            // writing `scrub: true` - and believing it does something is the
            // whole failure. Ungated for the same reason as the apiKey warning:
            // the production build is where the belief costs something.
            if (resolved.scrub && (resolved.scrub.rules?.length ?? 0) === 0) {
                console.warn(
                    '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                    `Scrubbing is enabled but no rules are configured, so nothing is redacted. `
                    + `Use \x1b[36mpreset: 'standard'\x1b[0m, or pass rules explicitly: `
                    + `\x1b[36mscrub: { rules: [...RECOMMENDED_RULES] }\x1b[0m.`
                );
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
            }, {
                name: 'getFroggerHealth',
                from: resolver.resolve('./runtime/shared/utils/health')
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

            if (resolved.tracePropagation !== false) {
                addPlugin(resolver.resolve('./runtime/app/plugins/trace-propagation.client'))
            }

            if (metricsEnabled) {
                addPlugin(resolver.resolve('./runtime/metrics/app/plugins/metrics.client'))

                // The manual metrics API is registered only with the subsystem,
                // so a bare install never pulls the metrics queue into the bundle.
                addImports([
                    {
                        name: 'froggerMetrics',
                        from: resolver.resolve('./runtime/metrics/app/utils/metrics')
                    },
                    {
                        name: 'setFroggerMetricsUser',
                        from: resolver.resolve('./runtime/metrics/app/utils/metrics')
                    }
                ])
            }

            if (resolved.errorCapture.client) {
                if (allowInternal('info')) {
                    console.log('🐸 FROGGER: Setting up Vue global error capture');
                }
                addPlugin(resolver.resolve('./runtime/app/plugins/global-vue-errors'))
            }
        }

        if (serverModuleEnabled) {
            _nuxt.options.alias['#frogger/server'] = resolver.resolve('./runtime/server');

            // One implementation, registered unconditionally. There is no
            // runtime branch on `autoEventCapture` because there does not need
            // to be: the nitro:config hook above sets
            // `experimental.asyncContext = autoEventCapture`, so with it off
            // `useEvent()` throws and the logger falls back to a fresh trace.
            addServerImports([
                {
                    name: 'getFrogger',
                    from: resolver.resolve('./runtime/server/utils/get-frogger')
                }
            ])

            addServerImports([
                {
                    name: 'HttpTransport',
                    from: resolver.resolve('./runtime/logger/_transports/http-transport')
                },
                {
                    // Makes "a log is never silently dropped" checkable rather
                    // than aspirational.
                    name: 'getFroggerHealth',
                    from: resolver.resolve('./runtime/shared/utils/health')
                },
                {
                    name: 'addGlobalTransport',
                    from: resolver.resolve('./runtime/server/utils/transport')
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

            // Metrics ingest route + queue lifecycle — registered ONLY when the
            // metrics subsystem is enabled (unlike the always-on log route).
            // The route is the RESOLVED endpoint, so a custom
            // `metrics.public.endpoint` serves where the client posts; `false`
            // registers no route at all.
            if (metricsEnabled) {
                addServerImports([
                    {
                        name: 'froggerMetrics',
                        from: resolver.resolve('./runtime/metrics/server/utils/metrics')
                    }
                ])

                addServerPlugin(resolver.resolve('./runtime/metrics/server/plugins/metrics-queue.server'))

                // Per-request instrumentation is its own opt-in inside metrics:
                // it adds a measurement to every request.
                if (metrics.requests) {
                    addServerPlugin(resolver.resolve('./runtime/metrics/server/plugins/request-metrics.server'))
                }

                if (metrics.runtime) {
                    addServerPlugin(resolver.resolve('./runtime/metrics/server/plugins/runtime-metrics.server'))
                }
                if (metrics.public.endpoint !== false) {
                    addServerHandler({
                        route: metrics.public.endpoint || DEFAULT_METRICS_ENDPOINT,
                        handler: resolver.resolve('./runtime/metrics/server/api/metrics.post'),
                    })
                }
            }

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
