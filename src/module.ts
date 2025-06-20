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

import { join, isAbsolute } from 'node:path'
import { defu } from 'defu'

import {
    DEFAULT_LOGGING_ENDPOINT,
    DEFAULT_WEBSOCKET_ENDPOINT
} from './runtime/shared/types/module-options'

import type { ModuleOptions } from './runtime/shared/types/module-options'
import { loadFroggerConfig } from './runtime/shared/utils/frogger-config'



export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-frogger',
        configKey: 'frogger',
    },
    defaults: {
        clientModule: true,
        serverModule: {
            autoEventCapture: true
        },

        app: 'nuxt-frogger',
        
        batch: {
            maxSize: 200,
            maxAge: 15000,
            retryOnFailure: true,
            maxRetries: 5,
            retryDelay: 10000,
            sortingWindowMs: 3000,
        },
        
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            flushInterval: 1000,
            bufferMaxSize: 1 * 1024 * 1024,
            highWaterMark: 64 * 1024,
        },
        
        rateLimit: {      
            storage: {
                driver: undefined,
                options: {}
            },

            limits: {
                global: 10000,
                perIp: 100,
                perReporter: 50,
                perApp: 30
            },
            
            windows: {
                global: 60,
                perIp: 60,
                perReporter: 60,
                perApp: 60
            },
            
            blocking: {
                enabled: true,
                escalationResetHours: 24,
                timeouts: [60, 300, 1800],
                violationsBeforeBlock: 3,
                finalBanHours: 12
            },
        },

        scrub: {
            maxDepth: 10,
            deepScrub: true,
            preserveTypes: true,
        },

        websocket: {
            route: DEFAULT_WEBSOCKET_ENDPOINT,
            defaultChannel: 'main',
            maxConcurrentQueries: 10,
            maxQueryResults: 1000,
            defaultQueryTimeout: 30000,
        },

        public: {
            endpoint: DEFAULT_LOGGING_ENDPOINT,
            
            globalErrorCapture: {
                includeComponent: true,
                includeComponentProps: false,
                includeComponentOuterHTML: true,
                includeStack: true,
                includeInfo: true
            },


            batch: {
                maxAge: 3000,
                maxSize: 100,
                retryOnFailure: true,
                maxRetries: 3,
                retryDelay: 3000,
                sortingWindowMs: 1000,
            },
        }
    },
    async setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        
        // Provide #frogger import alias
        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger/config'] = resolver.resolve('./runtime/options');


        // Try to load configuration from frogger.config.ts or frogger.config.js
        const froggerConfig = await loadFroggerConfig(_nuxt.options.rootDir);

        let finalOptions: ModuleOptions
        
        if (froggerConfig) { 
            finalOptions = defu(froggerConfig, _options) as ModuleOptions;
        }
        else {
            finalOptions = _options
        }

        if (finalOptions.serverModule === false && finalOptions.clientModule === false) {
            throw new Error('🐸FROGGER: `serverModule` and `clientModule` are both set to `false`. At least one is required to use Frogger.');
        }
        

        // Setup log directory
        const configuredDirectory = finalOptions.file?.directory || 'logs';
        const logDir = isAbsolute(configuredDirectory) 
            ? configuredDirectory 
            : join(_nuxt.options.rootDir, configuredDirectory);




        // Set runtime config
        const moduleRuntimeConfig = {
            public: {
                frogger: {
                    app: finalOptions.app,
                    clientModule: finalOptions.clientModule,
                    serverModule: finalOptions.serverModule === true || typeof finalOptions.serverModule === 'object' ? true : false,
                    globalErrorCapture: finalOptions.public?.globalErrorCapture,
                    endpoint: finalOptions.public?.endpoint,
                    baseUrl: finalOptions.public?.baseUrl || _nuxt.options.app.baseURL,
                    batch: finalOptions.public?.batch,
                    scrub: finalOptions.scrub,

                    websocket: {
                        route: typeof finalOptions.websocket === 'object' ? finalOptions.websocket.route : DEFAULT_WEBSOCKET_ENDPOINT,
                        defaultChannel: typeof finalOptions.websocket === 'object' ? finalOptions.websocket.defaultChannel : 'main'
                    }
                },

            },
            frogger: {
                serverModule: finalOptions.serverModule,

                file: {
                    directory: logDir,
                    fileNameFormat: finalOptions.file?.fileNameFormat,
                    maxSize: finalOptions.file?.maxSize,
                    flushInterval: finalOptions.file?.flushInterval,
                    bufferMaxSize: finalOptions.file?.bufferMaxSize,
                    highWaterMark: finalOptions.file?.highWaterMark,
                },
                
                batch: finalOptions.batch,

                rateLimit: finalOptions.rateLimit,

                websocket: typeof finalOptions.websocket === 'object' ? finalOptions.websocket : finalOptions.websocket === true ? {
                    enabled: true,
                    route: DEFAULT_WEBSOCKET_ENDPOINT,
                    defaultChannel: 'main'
                } : false,

                scrub: finalOptions.scrub,
            }
        };

        updateRuntimeConfig(moduleRuntimeConfig)


        _nuxt.hook('nitro:config', async (nitroConfig: any) => {
            nitroConfig.experimental = nitroConfig.experimental || {}

            nitroConfig.experimental.tasks = true
            nitroConfig.experimental.asyncContext = true

            if (finalOptions.serverModule) {
                if (finalOptions.websocket) {
                    nitroConfig.experimental.websocket = true;
                }

                if (typeof finalOptions.serverModule === 'object') {
                    nitroConfig.experimental.asyncContext = finalOptions.serverModule.autoEventCapture !== false;
                }
                else {
                    nitroConfig.experimental.asyncContext = true;
                }
            }
        })
        
        _nuxt.hook('nitro:build:before', () => {
            // Warnings
            if (finalOptions.serverModule === false && finalOptions.public?.endpoint === DEFAULT_LOGGING_ENDPOINT) {
                console.log(
                '🐸 \x1b[32mFROGGER\x1b[0m \x1b[33mWARN\x1b[0m',
                `You are using Frogger with \x1b[36mserverModule\x1b[0m set to \x1b[36mfalse\x1b[0m and no \x1b[36mpublic.endpoint\x1b[0m
                set in your \x1b[36mfrogger.config.ts\x1b[0m. Your logs will never leave the client!`
                );
            }

            if (_nuxt.options.dev && ( finalOptions.serverModule || finalOptions.clientModule )) {
                console.log(
                    '🐸 \x1b[32mFROGGER\x1b[0m',
                    `Ready to log`
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
                    console.log(
                        '\x1b[36mℹ\x1b[0m frogger.config.ts updated. Restarting Nuxt...'
                    );
                    
                    _nuxt.callHook('restart', { hard: true });
                }
            });
        }


        if (finalOptions.clientModule) {
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');
            
            // Composables
            const clientComposables = [{
                name: 'useFrogger',
                from: resolver.resolve('./runtime/app/composables/useFrogger')
            }]
            if (finalOptions.websocket && finalOptions.serverModule !== false) {
                clientComposables.push({
                    name: 'useWebsocket',
                    from: resolver.resolve('./runtime/app/composables/useWebsocket')
                })
            }
            addImports(clientComposables)

            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addPlugin(resolver.resolve('./runtime/app/plugins/log-queue.client'))
            
            if (finalOptions.public?.globalErrorCapture !== false && finalOptions.public?.globalErrorCapture !== undefined) {
                addPlugin(resolver.resolve('./runtime/app/plugins/global-vue-errors'))
            }

            if (finalOptions.websocket) {
                addImportsDir(resolver.resolve('./runtime/app/composables/useWebsocket'))
            }
        }

        if (finalOptions.serverModule) {
            _nuxt.options.alias['#frogger/server'] = resolver.resolve('./runtime/server');

            const autoEventCapture = typeof finalOptions.serverModule === 'object'
                ? finalOptions.serverModule.autoEventCapture !== false
                : finalOptions.serverModule;

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
                }
            ])
                
            addServerPlugin(resolver.resolve('./runtime/server/plugins/log-queue.server'))
            addServerPlugin(resolver.resolve('./runtime/server/plugins/trace-headers.server'))
            
            addServerHandler({
                route: '/api/_frogger/logs',
                handler: resolver.resolve('./runtime/server/api/logger.post'),
            })

            if (finalOptions.websocket) {
                if (_nuxt.options.dev) {
                    const wsRoute = typeof finalOptions.websocket === 'object' ? finalOptions.websocket.route || '/api/_frogger/dev-ws' : '/api/_frogger/dev-ws';
                    
                    addServerHandler({
                        route: wsRoute,
                        handler: resolver.resolve('./runtime/server/api/dev-websocket-handler'),
                    })
                }
            }
        }
    },
})
