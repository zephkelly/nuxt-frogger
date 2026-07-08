// Hierarchical spans demo. Everything logged inside `frogger.span()` —
// including logs from `chargeCard()`, which never receives a logger — nests
// under that span. Check logs/ for the tree: shared traceId, with parentId
// chaining request → processOrder → gateway. Two concurrent requests produce
// two independent trees (AsyncLocalStorage isolation).
export default defineEventHandler(async () => {
    frogger.info('request received')

    const result = await frogger.span('processOrder', async () => {
        frogger.info('validating order')

        await chargeCard('order_42')

        // A held span logger can also be passed around explicitly.
        const audit = frogger.startSpan('audit')
        audit.info('order recorded for audit')

        return { orderId: 'order_42', status: 'charged' }
    })

    frogger.info('request complete', result)

    return { ok: true, result }
})
