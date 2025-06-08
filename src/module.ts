import {
    defineNuxtModule,
    addPlugin,
    createResolver,
    addServerPlugin,
    addImportsDir,
    addServerImportsDir,
    addServerImports,
    addServerHandler,
    updateRuntimeConfig
} from '@nuxt/kit'

import { join, isAbsolute } from 'node:path'

import type { ModuleOptions } from './runtime/shared/types/module-options'
import { loadFroggerConfig } from './runtime/shared/utils/frogger-config'

import { defu } from 'defu'



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
    async setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        

        const froggerConfig = await loadFroggerConfig(_nuxt.options.rootDir);

        let finalOptions: ModuleOptions
        const hasNuxtConfigOptions = Object.keys(_options).length > 0
        
        if (froggerConfig) {   
            finalOptions = defu(_options, froggerConfig) as ModuleOptions;
        }
        else {
            finalOptions = _options
        }



        // Setup log directory
        const configuredDirectory = finalOptions.file?.directory || 'logs';
        const logDir = isAbsolute(configuredDirectory) 
            ? configuredDirectory 
            : join(_nuxt.options.rootDir, configuredDirectory);


        // Provide #frogger import alias
        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger'] = resolver.resolve('./runtime/index');


        // Set runtime config
        const moduleRuntimeConfig = {
            public: {
                frogger: {
                    clientModule: finalOptions.clientModule,
                    app: finalOptions.app,
                    globalErrorCapture: finalOptions.public?.globalErrorCapture,
                    endpoint: finalOptions.public?.endpoint,
                    batch: finalOptions.public?.batch,
                    scrub: finalOptions.scrub,

                    websocket: {
                        route: typeof finalOptions.websocket === 'object' ? finalOptions.websocket.route : '/api/_frogger/dev-ws',
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
                    route: '/api/_frogger/dev-ws',
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

            if (hasNuxtConfigOptions) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81); font-weight: bold; font-size: 1.15rem;',
                    '🐸 frogger.config.ts and module options defined. Preferring frogger.config.ts'
                )
            }
            
            if (finalOptions.serverModule) {
                const serverBatchStatus = finalOptions.batch === false ? '(immediate)' : '(batched)';
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering server module ${serverBatchStatus}`
                );
            }
            
            if (finalOptions.clientModule) {
                const clientBatchStatus = finalOptions.public?.batch === false ? '(immediate)' : '(batched)';
                console.log(
                    '%cFROGGER', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering client module ${clientBatchStatus}`
                );
            }
            
            if (finalOptions.websocket) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: #9333ea; font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering Websocket`
                );
            }

            if (_nuxt.options.dev && ( finalOptions.serverModule || finalOptions.clientModule )) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Ready to log`
                );
            }

        })


        if (finalOptions.clientModule) {
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');
            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addImportsDir(resolver.resolve('./runtime/app/composables'))
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
                    name: 'HttpReporter',
                    from: resolver.resolve('./runtime/server/utils/reporters/http-reporter')
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
                        handler: resolver.resolve('./runtime/server/api/dev-websocket-handler.ts'),
                    })
                }
            }
        }
    },
})
