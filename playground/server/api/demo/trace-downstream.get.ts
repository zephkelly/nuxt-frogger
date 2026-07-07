// Second server hop. getFrogger() continues the trace passed in by the first
// hop, so this log shares the same traceId — its span just points one level deeper.
export default defineEventHandler((event) => {
    const logger = getFrogger({ context: { hop: 'server-2' } }, event)

    logger.info('downstream service reached — same trace, deeper span')

    return {
        hop: 'server-2',
        traceparent: logger.getHeaders().traceparent,
    }
})
