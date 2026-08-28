// @vitest-environment nuxt
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'

import type { LoggerObject } from '../../src/runtime/shared/types/log'
import type { IFroggerLogger } from '../../src/runtime/logger/types'

type ConsoleOutputConfig = boolean | { client?: boolean; server?: boolean } | undefined

const { useRuntimeConfigMock, useNuxtAppMock, configState, enqueueLog } = vi.hoisted(() => {
    const configState = { consoleOutput: undefined as ConsoleOutputConfig }
    return {
        configState,
        enqueueLog: vi.fn(),
        useNuxtAppMock: vi.fn(() => ({})),
        useRuntimeConfigMock: vi.fn(() => ({
            frogger: { file: false, batch: false },
            public: {
                frogger: {
                    serverModule: true,
                    app: 'test-app',
                    // Empty endpoint short-circuits the client's network send,
                    // so tests observe logs purely via custom reporters.
                    endpoint: '',
                    baseUrl: '',
                    batch: false,
                    scrub: false,
                    consoleOutput: configState.consoleOutput,
                },
            },
        })),
    }
})

mockNuxtImport('useRuntimeConfig', () => useRuntimeConfigMock)
mockNuxtImport('useNuxtApp', () => useNuxtAppMock)
mockNuxtImport('useState', () => <T>(_key: string, init?: () => T) => ref(init ? init() : undefined))

vi.mock('../../src/runtime/server/services/server-log-queue', () => ({
    ServerLogQueueService: {
        getInstance: () => ({ enqueueLog, flush: vi.fn() }),
    },
}))

import { ServerFroggerLogger } from '../../src/runtime/logger/server'
import { ClientFrogger } from '../../src/runtime/logger/client'
import { ConsoleReporter } from '../../src/runtime/logger/_reporters/console-reporter'
import type { FroggerOptions } from '../../src/runtime/shared/types/options'

// Consola dispatches to reporters without awaiting; flush before asserting.
function flush(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

// The console reporter is deliberately NOT a user reporter: it is Frogger's own
// output channel, held privately so `getReporters()` cannot leak it and
// `clearReporters()` cannot silently kill console output. Reading the private
// field is therefore the direct expression of "this logger will print".
function printsToConsole(logger: IFroggerLogger): boolean {
    return (logger as unknown as { consoleReporter: unknown }).consoleReporter instanceof ConsoleReporter
}

function client(options: FroggerOptions = {}): ClientFrogger {
    return new ClientFrogger(ref(true), options)
}

function server(options: FroggerOptions = {}): ServerFroggerLogger {
    return new ServerFroggerLogger(options)
}

// What module.ts actually serialises into public runtime config: a resolved
// per-runtime pair, never the raw module option.
const SILENT = { client: false, server: false }
const LOUD = { client: true, server: true }

describe('consoleOutput', () => {
    beforeEach(() => {
        configState.consoleOutput = undefined
        enqueueLog.mockClear()
    })

    describe('module default', () => {
        it('prints on both runtimes when unset', () => {
            expect(printsToConsole(client())).toBe(true)
            expect(printsToConsole(server())).toBe(true)
        })

        it('silences both runtimes when both sides are off', () => {
            configState.consoleOutput = SILENT
            expect(printsToConsole(client())).toBe(false)
            expect(printsToConsole(server())).toBe(false)
        })

        // Runtime config is overridable from nuxt.config, so the un-normalised
        // shape must not be silently ignored.
        it('honours a bare boolean written directly into runtime config', () => {
            configState.consoleOutput = false
            expect(printsToConsole(client())).toBe(false)
            expect(printsToConsole(server())).toBe(false)

            configState.consoleOutput = true
            expect(printsToConsole(client())).toBe(true)
            expect(printsToConsole(server())).toBe(true)
        })

        it('client:false silences the browser but leaves the server console alone', () => {
            configState.consoleOutput = { client: false }
            expect(printsToConsole(client())).toBe(false)
            expect(printsToConsole(server())).toBe(true)
        })

        it('server:false silences the server but leaves the browser alone', () => {
            configState.consoleOutput = { server: false }
            expect(printsToConsole(client())).toBe(true)
            expect(printsToConsole(server())).toBe(false)
        })
    })

    describe('per-logger precedence', () => {
        it('an explicit true re-enables the console under a module-wide false', () => {
            configState.consoleOutput = SILENT
            expect(printsToConsole(client({ consoleOutput: true }))).toBe(true)
            expect(printsToConsole(server({ consoleOutput: true }))).toBe(true)
        })

        it('an explicit false silences a single logger under a module-wide true', () => {
            configState.consoleOutput = LOUD
            expect(printsToConsole(client({ consoleOutput: false }))).toBe(false)
            expect(printsToConsole(server({ consoleOutput: false }))).toBe(false)
        })
    })

    // Children inherit the parent's resolved options. ClientFrogger used to
    // hardcode `consoleOutput: true` into that inherited set, so every child
    // and span outranked a module-wide `false` and kept printing.
    describe('inheritance through children and spans', () => {
        it('client children, reactive children and spans stay silent', () => {
            configState.consoleOutput = { client: false }
            const parent = client()

            expect(printsToConsole(parent.child({}))).toBe(false)
            expect(printsToConsole(parent.reactiveChild({}))).toBe(false)
            expect(printsToConsole(parent.startSpan('checkout'))).toBe(false)
            expect(printsToConsole(parent.startSpan('checkout').child({}))).toBe(false)
        })

        it('server children and spans stay silent', () => {
            configState.consoleOutput = { server: false }
            const parent = server()

            expect(printsToConsole(parent.child({}))).toBe(false)
            expect(printsToConsole(parent.startSpan('handler'))).toBe(false)
        })

        it('a parent that opted back in passes the console down to its children', () => {
            configState.consoleOutput = SILENT

            expect(printsToConsole(client({ consoleOutput: true }).child({}))).toBe(true)
            expect(printsToConsole(client({ consoleOutput: true }).startSpan('x'))).toBe(true)
            expect(printsToConsole(server({ consoleOutput: true }).child({}))).toBe(true)
        })

        it('a child can opt out of a console its parent keeps', () => {
            configState.consoleOutput = LOUD
            expect(printsToConsole(client().child({ consoleOutput: false }))).toBe(false)
            expect(printsToConsole(server().child({ consoleOutput: false }))).toBe(false)
        })
    })

    // The whole point of the option: silence the console, keep shipping logs.
    describe('transport delivery is unaffected', () => {
        it('a silenced server logger still enqueues onto the transport queue', async () => {
            configState.consoleOutput = SILENT
            server().info('shipped anyway')
            await flush()

            expect(enqueueLog).toHaveBeenCalledTimes(1)
            expect(enqueueLog.mock.calls[0]![0]).toMatchObject({ msg: 'shipped anyway' })
        })

        it('a silenced client logger still runs the reporter pipeline', async () => {
            configState.consoleOutput = SILENT
            const logger = client()

            const delivered: LoggerObject[] = []
            logger.addReporter({ log: (obj: LoggerObject) => { delivered.push(obj) } })

            logger.info('shipped anyway')
            await flush()

            expect(printsToConsole(logger)).toBe(false)
            expect(delivered).toHaveLength(1)
            expect(delivered[0]).toMatchObject({ msg: 'shipped anyway' })
        })

        it('a silenced span still enqueues onto the transport queue', async () => {
            configState.consoleOutput = { server: false }
            await server().span('work', () => {})

            // span() emits its own end event; the explicit log makes two.
            const child = server().startSpan('work')
            child.info('inside span')
            await flush()

            expect(printsToConsole(child)).toBe(false)
            expect(enqueueLog).toHaveBeenCalledTimes(2)
        })
    })
})
