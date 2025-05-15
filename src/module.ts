import { defineNuxtModule, addPlugin, createResolver, addServerPlugin, addImportsDir, addImports, addServerImportsDir } from '@nuxt/kit'

import { getTraceId, getSessionTraceId } from './runtime/server/utils/trace'



export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-trace',
        configKey: 'nuxt-trace',
    },
    // Default configuration options of the Nuxt module
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
        addPlugin(resolver.resolve('./runtime/plugin'))
        addServerPlugin(resolver.resolve('./runtime/server/plugins/tracing'))

        addServerImportsDir(resolver.resolve('./runtime/server/utils'))
    },
})
