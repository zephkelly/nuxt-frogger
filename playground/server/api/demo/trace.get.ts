// First server hop of a traced request.
// getFrogger() reads the incoming traceparent/tracestate (auto-captured from the
// event), so this log continues the client's trace. We then call a second route
// with logger.getHeaders() so the whole chain shares one traceId.
export default defineEventHandler(async (event) => {
    const logger = getFrogger({ context: { hop: 'server-1' } }, event)

    logger.info('received traced request from client')

    const downstream = await $fetch<Record<string, any>>('/api/demo/trace-downstream', {
        headers: logger.getHeaders(),
    })

    const headers = logger.getHeaders()

    return {
        hop: 'server-1',
        traceparent: headers.traceparent,
        tracestate: headers.tracestate,
        downstream,
    }
})
