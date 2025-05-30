import { server } from "typescript";

export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,
    
    frogger: {
        batch: {
            client: false,
            server: false
        }
    }
})
