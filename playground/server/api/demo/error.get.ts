// Throws an uncaught error. Nitro's `error` hook captures it and Frogger logs
// it server-side (see your terminal and playground/logs/). The client receives
// the expected 500.
export default defineEventHandler(() => {
    throw new Error('Boom — uncaught error from a server route')
})
