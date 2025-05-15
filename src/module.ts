import { join, resolve } from 'pathe'

import {
    defineNuxtModule,
    addPlugin,
    createResolver,
    addServerPlugin,
    addImportsDir,
    addServerImportsDir
} from '@nuxt/kit'



export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-trace',
        configKey: 'nuxt-trace',
    },
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        const runtimeDir = resolve('./runtime')

        _nuxt.options.alias['#nuxt-trace'] = runtimeDir


        addPlugin(resolver.resolve('./runtime/plugin'))
        addServerPlugin(resolver.resolve('./runtime/server/plugins/tracing'))

        addServerImportsDir(resolver.resolve('./runtime/server/utils'))
        addImportsDir(resolver.resolve('./runtime/shared/types'))
    },
})
