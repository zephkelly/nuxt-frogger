import { join, resolve } from 'pathe'

import {
    defineNuxtModule,
    addPlugin,
    createResolver,
    addServerPlugin,
    addImportsDir,
    addServerImportsDir,
    addServerHandler
} from '@nuxt/kit'



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean

    file?: {
        directory?: string
        fileNameFormat?: string
        maxSize?: number
        format?: 'json' | 'text'
    }
    batch?: {
        maxSize?: number
        maxAge?: number
        retryOnFailure?: boolean
        maxRetries?: number
        retryDelay?: number
    } | boolean
    endpoint: string
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'frogger',
        configKey: 'frogger',
    },
    defaults: {
        clientModule: true,
        serverModule: true,
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            format: 'json'
        },
        batch: false,
        endpoint: '/api/_frogger/logs'
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        const logDir = join(_nuxt.options.rootDir, _options.file?.directory || 'logs');
        if (_options.file && typeof _options.file === 'object') {
            _options.file.directory = logDir;
        } else if (_options.file === true) {
            _options.file = { directory: logDir };
        }

        _nuxt.options.alias = _nuxt.options.alias || {};
        _nuxt.options.alias['#frogger'] = resolver.resolve('./runtime/frogger');

        if (_options.clientModule) {
            console.log('Adding client module')
            _nuxt.options.alias['#frogger/client'] = resolver.resolve('./runtime/app');
            addImportsDir(resolver.resolve('./runtime/app/utils'))
            addImportsDir(resolver.resolve('./runtime/app/composables'))
            addPlugin(resolver.resolve('./runtime/app/plugins/log-queue.client'))
        }

        if (_options.serverModule) {
            console.log('Adding server module')
            _nuxt.options.alias['#frogger/server'] = resolver.resolve('./runtime/server');
            addServerImportsDir(resolver.resolve('./runtime/server/utils'))
            addServerPlugin(resolver.resolve('./runtime/server/plugins/log-queue.server'))
            addServerHandler({
                route: '/api/_frogger/logs',
                handler: resolver.resolve('./runtime/server/api/logger.post'),
            })
        }
    },
})
