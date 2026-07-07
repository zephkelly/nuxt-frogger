// Logs an object containing PII server-side. Frogger's scrubber runs before the
// record is written to disk, so the stored log under playground/logs/ has the
// sensitive fields masked / redacted / hashed — even though we return the raw
// object here so you can compare input vs. stored output.
export default defineEventHandler((event) => {
    const logger = getFrogger({ context: { route: 'demo/scrub' } }, event)

    const profile = {
        userId: 'u_98217',
        email: 'jane.doe@example.com',
        phone: '+1 (555) 123-4567',
        password: 'hunter2',
        apiKey: 'sk_live_5fThisShouldNeverAppear',
        creditCard: '4111 1111 1111 1111',
        fullName: 'Jane Doe',
    }

    logger.info('user profile (with PII)', profile)

    return { logged: true, rawInput: profile }
})
