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



export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'frogger',
        configKey: 'frogger',
    },
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        const runtimeDir = resolve('./runtime')

        addServerImportsDir(resolver.resolve('./runtime/server/utils'))

        addImportsDir(resolver.resolve('./runtime/app/utils'))

        addImportsDir(resolver.resolve('./runtime/app/composables'))

        addServerHandler({
            route: '/api/_frogger/logs',
            handler: resolver.resolve('./runtime/server/api/logger.post'),
        })
    },
})
