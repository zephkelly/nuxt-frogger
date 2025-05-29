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
    
    endpoint?: string

    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
    }

    batch?: {
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
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

        endpoint: '/api/_frogger/logs',

        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
        },

        batch: {
            maxSize: 100,
            maxAge: 60000,
            retryOnFailure: true,
            maxRetries: 3,
            retryDelay: 5000,
        },
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
                    endpoint: _options.endpoint,
                    batch: {
                        maxSize: _options.batch?.maxSize,
                        maxAge: _options.batch?.maxAge,
                        retryOnFailure: _options.batch?.retryOnFailure,
                        maxRetries: _options.batch?.maxRetries,
                        retryDelay: _options.batch?.retryDelay,
                    }
                }
            },
            frogger: {
                file: {
                    directory: _options.file?.directory || logDir,
                    fileNameFormat: _options.file?.fileNameFormat,
                    maxSize: _options.file?.maxSize,
                }
            }
        }

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
                console.log(
                    '%cFROGGER', 'color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering server module`
                );
            }

            if (_options.clientModule) {
                console.log(
                    '%cFROGGER', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    `🐸 Registering client module`
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
