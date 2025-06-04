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
            globalErrorCapture: {
                includeComponentOuterHTML: false,
                includeComponentProps: false,
            }
        }
    }
})
