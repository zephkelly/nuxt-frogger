export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,

    frogger: {
        rateLimiter: {
            limits: {
                perIp: 10,
            }
        },

        public: {
            app: {
                name: 'paincoach',
                version: '1.0.0',
            },
            globalErrorCapture: {
                includeComponentOuterHTML: false,
                includeComponentProps: false,
            }
        }
    }
})
