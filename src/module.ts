import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'

export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'my-module',
        configKey: 'myModule',
    },
    // Default configuration options of the Nuxt module
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
        addPlugin(resolver.resolve('./runtime/plugin'))
        addServerPlugin(resolver.resolve('./runtime/server/plugins/tracing'))
    },
})
