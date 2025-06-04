export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,

    frogger: {
        app: {
            name: 'test-nuxt-frogger',
            version: '1.0.0',
        },

        rateLimiter: {
            limits: {
                perIp: 10,
            }
        },

        public: {
            globalErrorCapture: {
                includeComponentOuterHTML: false,
                includeComponentProps: false,
            }
        }
    }
})
