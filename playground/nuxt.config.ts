export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,
    
    frogger: {
        file: {
            flushInterval: 1000,
        },
        batch: {
            maxAge: 1000,
        }
    }
})
