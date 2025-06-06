import {
    defineNuxtModule,
    addPlugin,
    createResolver,
    addServerPlugin,
    addImportsDir,
    addServerImportsDir,
    addServerHandler,
    updateRuntimeConfig
} from '@nuxt/kit'

import { join, isAbsolute } from 'node:path'

import type { ModuleOptions } from './runtime/shared/types/module-options'



export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-frogger',
        configKey: 'frogger',
    },
    defaults: {
        clientModule: true,
        serverModule: true,

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
            route: '/api/_frogger/dev-ws',
            defaultChannel: 'main',
            maxConcurrentQueries: 10,
            maxQueryResults: 1000,
            defaultQueryTimeout: 30000,
        },

        // Set in the public runtime config, can be overridden
        // at runtime using 'NUXT_PUBLIC_FROGGER_' environment variables
        public: {
            endpoint: '/api/_frogger/logs',
            
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
            }
        }
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        const configuredDirectory = _options.file?.directory || 'logs';
        const logDir = isAbsolute(configuredDirectory) 
            ? configuredDirectory 
            : join(_nuxt.options.rootDir, configuredDirectory);

        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger'] = resolver.resolve('./runtime/index');

        const moduleRuntimeConfig = {
            public: {
                frogger: {
                    app: _options.app,
                    globalErrorCapture: _options.public?.globalErrorCapture,
                    endpoint: _options.public?.endpoint,
                    batch: _options.public?.batch,
                    scrub: _options.scrub,
                },

                websocket: {
                    route: typeof _options.websocket === 'object' ? _options.websocket.route : '/api/_frogger/dev-ws',
                    defaultChannel: typeof _options.websocket === 'object' ? _options.websocket.defaultChannel : 'main'
                }
            },
            frogger: {
                file: {
                    directory: logDir,
                    fileNameFormat: _options.file?.fileNameFormat,
                    maxSize: _options.file?.maxSize,
                    flushInterval: _options.file?.flushInterval,
                    bufferMaxSize: _options.file?.bufferMaxSize,
                    highWaterMark: _options.file?.highWaterMark,
                },
                
                batch: _options.batch,

                rateLimit: _options.rateLimit,

                websocket: typeof _options.websocket === 'object' ? _options.websocket : _options.websocket === true ? {
                    enabled: true,
                    route: '/api/_frogger/dev-ws',
                    defaultChannel: 'main'
                } : false,

                scrub: _options.scrub,
            }
        };

        updateRuntimeConfig(moduleRuntimeConfig)

        
        _nuxt.hook('nitro:build:before', () => {
            if (_nuxt.options.dev && ( _options.serverModule || _options.clientModule )) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Ready to log`
                );
            }

            if (_options.serverModule) {
                const serverBatchStatus = _options.batch === false ? '(immediate)' : '(batched)';
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering server module ${serverBatchStatus}`
                );
            }

            if (_options.clientModule) {
                const clientBatchStatus = _options.public?.batch === false ? '(immediate)' : '(batched)';
                console.log(
                    '%cFROGGER', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering client module ${clientBatchStatus}`
                );
            }

            if (_options.websocket) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: #9333ea; font-weight: bold; font-size: 1.15rem;',
                    `🐸 WebSocket logging registered`
                );
            }
        })


        if (_options.clientModule) {
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');
            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addImportsDir(resolver.resolve('./runtime/app/composables'))
            addPlugin(resolver.resolve('./runtime/app/plugins/log-queue.client'))
            
            if (_options.public?.globalErrorCapture !== false && _options.public?.globalErrorCapture !== undefined) {
                addPlugin(resolver.resolve('./runtime/app/plugins/global-vue-errors'))
            }

            if (_options.websocket) {
                addImportsDir(resolver.resolve('./runtime/app/composables/useWebsocket'))
            }
        }

        if (_options.serverModule) {
            _nuxt.options.alias['#frogger/server'] = resolver.resolve('./runtime/server');
            addServerImportsDir(resolver.resolve('./runtime/server/utils'))
            
            addServerPlugin(resolver.resolve('./runtime/server/plugins/log-queue.server'))
            addServerPlugin(resolver.resolve('./runtime/server/plugins/trace-headers.server'))
            
            addServerHandler({
                route: '/api/_frogger/logs',
                handler: resolver.resolve('./runtime/server/api/logger.post'),
            })

            if (_options.websocket) {
                addServerImportsDir(resolver.resolve('./runtime/server/websocket'))
                
                if (_nuxt.options.dev) {
                    const wsRoute = typeof _options.websocket === 'object' ? _options.websocket.route || '/api/_frogger/dev-ws' : '/api/_frogger/dev-ws';
                    
                    addServerHandler({
                        route: wsRoute,
                        handler: resolver.resolve('./runtime/server/api/dev-websocket-handler.ts'),
                    })
                }
            }
        }
    },
})
