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
        name: 'frogger',
        configKey: 'frogger',
    },
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        const runtimeDir = resolve('./runtime')

        // _nuxt.options.alias['#frogger'] = runtimeDir

        addServerImportsDir(resolver.resolve('./runtime/server/utils'))

        addImportsDir(resolver.resolve('./runtime/app/utils'))


    },
})
