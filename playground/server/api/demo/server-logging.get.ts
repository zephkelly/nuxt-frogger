// Server-side logging with getFrogger(): initial context, addContext, and
// child / reactiveChild loggers. getFrogger() auto-captures the current request
// event, so these logs continue the incoming client trace.
export default defineEventHandler((event) => {
    const logger = getFrogger({
        context: { route: 'demo/server-logging' },
    }, event)

    logger.info('handling request')

    // Merge more context as the request progresses.
    logger.addContext({ step: 'validated' })
    logger.info('input validated')

    // A child inherits the parent's context plus its own.
    const child = logger.child({ context: { worker: 'pricing' } })
    child.success('priced order', { total: 4999 })

    // A reactive child keeps inheriting later parent changes.
    const reactive = logger.reactiveChild({ context: { worker: 'audit' } })
    logger.addContext({ requestId: 'req_' + Math.round(Math.random() * 1e6) })
    reactive.info('audit recorded (note the inherited requestId)')

    return { ok: true }
})
