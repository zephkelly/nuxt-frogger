import { createResolver, defineNuxtModule } from "@nuxt/kit";



export default defineNuxtModule<{}>({
    setup(_options, nuxt) {
        const { resolve } = createResolver(import.meta.url);

        nuxt.hook('nitro:config', (nitro) => {
            nitro.plugins = nitro.plugins || [];

            nitro.plugins.push(resolve('./runtime/server/plugins/global-error.server'));
        });
    }
});