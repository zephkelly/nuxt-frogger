import { describe, it, expect, beforeAll } from 'vitest'

import { registerFroggerMatchers } from '../../src/testing'

import type { LoggerObject } from '../../src/runtime/shared/types/log'

function makeLog(overrides: Partial<LoggerObject> = {}): LoggerObject {
    return {
        id: 'fixture-id',
        time: 0,
        lvl: 3,
        sev: 9,
        type: 'info',
        msg: 'hello',
        ctx: {},
        env: 'server',
        trace: { traceId: 'trace-a', spanId: 'span-a' },
        ...overrides,
    }
}

beforeAll(async () => {
    await registerFroggerMatchers()
})

describe('toHaveLogged', () => {
    const logs = [
        makeLog({ lvl: 1, sev: 9, type: 'warn', msg: 'please redeploy' }),
        makeLog({ lvl: 3, sev: 9, type: 'info', msg: 'all good' }),
    ]

    it('passes when a matching log exists', () => {
        expect(logs).toHaveLogged({ level: 'warn', msg: /redeploy/ })
    })

    it('supports .not when no log matches', () => {
        expect(logs).not.toHaveLogged({ level: 'error' })
    })

    it('fails with a helpful message when nothing matches', () => {
        expect(() => expect(logs).toHaveLogged({ msg: 'nonexistent' }))
            .toThrowError(/expected a log matching/)
    })

    it('fails on .not when a log unexpectedly matches', () => {
        expect(() => expect(logs).not.toHaveLogged({ level: 'warn' }))
            .toThrowError(/expected no log matching/)
    })
})
