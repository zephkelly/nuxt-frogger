import { describe, it, expect } from 'vitest'

import { LogScrubber } from '../src/runtime/scrubber/index'
import { SCRUB_STRATEGY } from '../src/runtime/scrubber/strategies'
import { PASSWORD_FIELDS } from '../src/runtime/scrubber/field-lists'
import type { LoggerObject } from '../src/runtime/shared/types/log'

function scrubber() {
    return new LogScrubber({
        deepScrub: true,
        rules: [{
            action: SCRUB_STRATEGY.REDACT,
            fieldPatterns: PASSWORD_FIELDS,
            priority: 100,
        }],
    })
}

function row(ctx: Record<string, unknown>): LoggerObject {
    return {
        id: 'id-1',
        time: Date.now(),
        lvl: 3,
        sev: 9,
        type: 'error',
        msg: 'boom',
        ctx,
        env: 'server',
        trace: { traceId: 't', spanId: 's' },
    }
}

describe('scrubbing container types', () => {
    it('redacts inside a Headers instance instead of passing it through', () => {
        // `Object.entries(new Headers())` is `[]`, so the old traversal found
        // nothing and emitted the instance by reference, unredacted.
        const headers = new Headers({ cookie: 'session=abc', 'x-api-key': 'live-key', accept: 'json' })
        const log = row({ request: { headers } })

        scrubber().scrubLoggerObject(log)

        const scrubbed = log.ctx.request.headers as Record<string, string>
        expect(scrubbed.cookie).not.toContain('session=abc')
        expect(scrubbed['x-api-key']).not.toContain('live-key')
        expect(scrubbed.accept).toBe('json')
    })

    it('redacts inside a Map', () => {
        const log = row({ meta: new Map<string, string>([['token', 'live-token'], ['page', '3']]) })

        scrubber().scrubLoggerObject(log)

        const scrubbed = log.ctx.meta as Record<string, string>
        expect(scrubbed.token).not.toBe('live-token')
        expect(scrubbed.page).toBe('3')
    })

    it('converts a Set to an array so nested objects inside it are reachable', () => {
        const log = row({ items: new Set([{ password: 'hunter2' }, { safe: 'yes' }]) })

        scrubber().scrubLoggerObject(log)

        const scrubbed = log.ctx.items as Array<Record<string, string>>
        expect(Array.isArray(scrubbed)).toBe(true)
        expect(scrubbed[0]!.password).not.toBe('hunter2')
        expect(scrubbed[1]!.safe).toBe('yes')
    })

    it('leaves an arbitrary class instance alone rather than walking it', () => {
        // Explicit, not accidental: walking any class is how a scrubber ends up
        // serialising a database connection into a log row.
        class Connection {
            constructor(public readonly password: string) {}
        }
        const connection = new Connection('hunter2')
        const log = row({ connection })

        scrubber().scrubLoggerObject(log)

        expect(log.ctx.connection).toBeInstanceOf(Connection)
    })

    it('covers cookie and authorization as field names too', () => {
        const log = row({ cookie: 'session=abc', authorization: 'Bearer live' })

        scrubber().scrubLoggerObject(log)

        expect(log.ctx.cookie).not.toContain('session=abc')
        expect(log.ctx.authorization).not.toContain('Bearer live')
    })
})
