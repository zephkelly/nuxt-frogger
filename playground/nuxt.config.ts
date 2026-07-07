export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    ssr: true,

    // Frogger works with zero config — everything below is on by default.
    // The WebSocket live-log stream (used by the /live-logs page) is registered
    // automatically in dev at `/api/_frogger/dev-ws`.
    //
    // To customise it, uncomment and adjust:
    // frogger: {
    //     websocket: {
    //         route: '/api/_frogger/dev-ws',
    //         // Gate who may open the live-log socket (return false to reject):
    //         upgrade: (request) => true,
    //     },
    // },
})
