import { createResolver, defineNuxtModule } from "@nuxt/kit";
import { froggerInternal } from "../../shared/utils/internal-log";



export default defineNuxtModule<{}>({
    setup (_options, nuxt) {
        const { resolve } = createResolver(import.meta.url);

        nuxt.hook('nitro:config', (nitro) => {
            froggerInternal.debug("Adding trace headers plugin to Nitro");
            nitro.plugins = nitro.plugins || [];

            nitro.plugins.push(resolve('./runtime/server/plugins/trace-headers.server'));
        });
    }
});