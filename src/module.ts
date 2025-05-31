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

import { join } from 'node:path'



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean
    
    
    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
        flushInterval?: number
        bufferMaxSize?: number
        highWaterMark?: number
    }
    
    batch?:{
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
        sortingWindowMs?: number
    }   | false
    
    public?: {
        endpoint?: string
        batch?: {
            maxSize?: number
            maxAge?: number
            retryOnFailure?: boolean
            maxRetries?: number
            retryDelay?: number
            sortingWindowMs?: number
        } | false
    }
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-frogger',
        configKey: 'frogger',
    },
    defaults: {
        clientModule: true,
        serverModule: true,

        
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            flushInterval: 1000,
            bufferMaxSize: 1 * 1024 * 1024,
            highWaterMark: 64 * 1024,
        },
        
        batch: {
            maxSize: 200,
            maxAge: 15000,
            retryOnFailure: true,
            maxRetries: 5,
            retryDelay: 10000,
            sortingWindowMs: 3000,
        },
        
        // Set in the 'frogger' property of the public runtime config,
        // override at runtime using 'NUXT_PUBLIC_FROGGER_'
        public: {
            endpoint: '/api/_frogger/logs',
            batch: {
                maxSize: 50,
                maxAge: 3000,
                retryOnFailure: true,
                maxRetries: 3,
                retryDelay: 3000,
                sortingWindowMs: 1000,
            }
        }
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        const logDir = join(_nuxt.options.rootDir, _options.file?.directory || 'logs');
        if (_options.file && typeof _options.file === 'object') {
            _options.file.directory = logDir;
        }
        else if (_options.file === true) {
            _options.file = { directory: logDir };
        }

        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger'] = resolver.resolve('./runtime/frogger');

        const moduleRuntimeConfig = {
            public: {
                frogger: {
                    endpoint: _options.public?.endpoint,
                    batch: _options.public?.batch
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
                
                batch: _options.batch
            }
        };

        updateRuntimeConfig(moduleRuntimeConfig)

        
        // Let the user know what they including in their bundle
        _nuxt.hook('nitro:build:before', () => {
            if (_nuxt.options.dev && ( _options.serverModule || _options.clientModule )) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Ready to log`
                );
                return;
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
        })


        if (_options.clientModule) {
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');
            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addImportsDir(resolver.resolve('./runtime/app/composables'))
            addPlugin(resolver.resolve('./runtime/app/plugins/log-queue.client'))
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
        }
    },
})
