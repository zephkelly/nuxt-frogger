// Deliberately takes no logger argument: the ambient `frogger` resolves to the
// active span's child logger, so these logs nest under whichever span the
// caller opened.
export async function chargeCard(orderId: string) {
    frogger.info('charging card', { orderId })

    await frogger.span('gateway', async () => {
        frogger.info('contacting payment gateway')
        await new Promise(resolve => setTimeout(resolve, 5))
        frogger.info('gateway accepted')
    })

    frogger.info('card charged')
}
