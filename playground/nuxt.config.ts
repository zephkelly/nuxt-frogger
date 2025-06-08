export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,

    frogger: {
        app: {
            name: 'my-app',
            version: '1.0.0'
        },
        serverModule: true
    }
})
