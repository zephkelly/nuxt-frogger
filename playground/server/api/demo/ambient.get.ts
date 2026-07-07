// The ambient `frogger` is auto-imported on the server too. It's backed by one
// logger per request, so every frogger.* call here shares a span chain that's
// correlated with the incoming client trace.
export default defineEventHandler(() => {
    frogger.info('server ambient log')
    frogger.log('processed items', 3, { batch: 'b_1' })

    try {
        throw new Error('simulated downstream failure')
    } catch (err) {
        // An Error is lifted into ctx.error (with its stack).
        frogger.warn('recovered from a downstream error', err as Error, { retried: true })
    }

    return { ok: true }
})
