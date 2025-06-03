export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,

    frogger: {
        rateLimiter: {
            limits: {
                perIp: 10,
            }
        }
    }
})
