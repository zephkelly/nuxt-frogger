/**
 * `nuxt-frogger/playwright` — Playwright fixtures for e2e logging assertions.
 *
 * Two jobs:
 *  1. Capture the client→server log batches an app POSTs during a flow, so a
 *     test can assert "this page logged X" — and, because client and server logs
 *     share a `traceId`, assert trace continuity across the boundary.
 *  2. Act as a tripwire: fail a test if Frogger itself logged an internal error
 *     to the console, so "Frogger must never be the reason my e2e fails" is
 *     enforced rather than hoped for.
 *
 * Imports only `@playwright/test` (an optional peer dependency) plus the pure
 * `filterLogs` predicate shared with `nuxt-frogger/testing`.
 */

import { test as base, expect } from '@playwright/test'

// Explicit extensions: these specifiers cross build-entry dirs, so mkdist emits
// them verbatim and they must resolve under plain Node ESM (how Playwright loads
// this package's built output).
import { filterLogs } from '../testing/index.js'

import type { Page } from '@playwright/test'
import type { LogMatcher } from '../testing/index.js'
import type { LoggerObject } from '../runtime/shared/types/log.js'
import type { LoggerObjectBatch } from '../runtime/shared/types/batch.js'

export type { LogMatcher, LoggerObject, LoggerObjectBatch }

/**
 * The stable prefix Frogger stamps on every internal-diagnostics console line
 * (see `internal-log.ts`). The `failOnFroggerInternalErrors` fixture filters on
 * it; documented as the tripwire string so consumers can match it themselves.
 */
export const FROGGER_INTERNAL_PREFIX = '🐸 Frogger'

/** Default client→server ingest route Frogger POSTs batches to. */
export const DEFAULT_FROGGER_ENDPOINT = '/api/_frogger/logs'

export interface FroggerCaptureOptions {
    /**
     * Ingest route to intercept. Matched as `**` + endpoint.
     * @default {@link DEFAULT_FROGGER_ENDPOINT}
     */
    endpoint?: string
}

export interface WaitForLogOptions {
    /** How long to wait for a matching log, in ms. @default 5000 */
    timeout?: number
    /** Poll interval, in ms. @default 50 */
    interval?: number
}

export interface FroggerCapture {
    /** Every captured log (flattened across batches), optionally filtered. */
    getLogs(matcher?: LogMatcher): LoggerObject[]
    /** Raw batches as received, newest last. */
    getBatches(): LoggerObjectBatch[]
    /** Resolve once a log matching `matcher` is captured, else reject on timeout. */
    waitForLog(matcher: LogMatcher, options?: WaitForLogOptions): Promise<LoggerObject>
    /** Assert (waiting up to the timeout) that a matching log was captured. */
    expectLog(matcher: LogMatcher, options?: WaitForLogOptions): Promise<LoggerObject>
    /** Drop all captured batches. */
    clear(): void
}

/**
 * Intercept the client→server log POSTs on `page`, collecting each
 * `LoggerObjectBatch` body, and `route.continue()` so the app still works.
 *
 * ```ts
 * const capture = await useFroggerCapture(page)
 * await page.getByRole('button', { name: 'Save' }).click()
 * const log = await capture.expectLog({ msg: /saved/, level: 'info' })
 * expect(log.trace.traceId).toBeTruthy()
 * ```
 */
export async function useFroggerCapture(
    page: Page,
    options: FroggerCaptureOptions = {},
): Promise<FroggerCapture> {
    const endpoint = options.endpoint ?? DEFAULT_FROGGER_ENDPOINT
    const batches: LoggerObjectBatch[] = []

    await page.route(`**${endpoint}`, async (route) => {
        const request = route.request()
        if (request.method() === 'POST') {
            try {
                const body = request.postDataJSON() as LoggerObjectBatch
                if (body && Array.isArray(body.logs)) {
                    batches.push(body)
                }
            }
            catch {
                // Malformed / non-JSON body — let it through untouched.
            }
        }
        await route.continue()
    })

    const allLogs = (): LoggerObject[] => batches.flatMap(b => b.logs)

    const waitForLog = async (
        matcher: LogMatcher,
        waitOptions: WaitForLogOptions = {},
    ): Promise<LoggerObject> => {
        const timeout = waitOptions.timeout ?? 5000
        const interval = waitOptions.interval ?? 50
        const start = Date.now()

        for (;;) {
            const matches = filterLogs(allLogs(), matcher)
            if (matches.length > 0) {
                return matches[0]!
            }
            if (Date.now() - start >= timeout) {
                throw new Error(
                    `useFroggerCapture: timed out after ${timeout}ms waiting for a log matching `
                    + `${JSON.stringify(matcher)} (captured ${allLogs().length} log(s)).`,
                )
            }
            await new Promise(resolve => setTimeout(resolve, interval))
        }
    }

    return {
        getBatches: () => batches,
        getLogs: (matcher?: LogMatcher) =>
            matcher ? filterLogs(allLogs(), matcher) : allLogs(),
        waitForLog,
        expectLog: waitForLog,
        clear: () => {
            batches.length = 0
        },
    }
}

/**
 * Playwright fixtures.
 *
 *  - `froggerCapture`: an auto-wired {@link FroggerCapture} for the page.
 *  - `failOnFroggerInternalErrors`: opt-in tripwire. Reference it in a test to
 *    fail that test if Frogger logs any internal-diagnostics line to the
 *    console.
 *
 * ```ts
 * import { test, expect } from 'nuxt-frogger/playwright'
 *
 * test('logs on save', async ({ page, froggerCapture, failOnFroggerInternalErrors }) => {
 *   await page.goto('/')
 *   await page.getByRole('button', { name: 'Save' }).click()
 *   await froggerCapture.expectLog({ msg: /saved/ })
 * })
 * ```
 */
export const test = base.extend<{
    froggerCapture: FroggerCapture
    failOnFroggerInternalErrors: void
}>({
    froggerCapture: async ({ page }, use) => {
        const capture = await useFroggerCapture(page)
        await use(capture)
    },
    failOnFroggerInternalErrors: async ({ page }, use) => {
        const internalMessages: string[] = []
        page.on('console', (msg) => {
            if (msg.text().startsWith(FROGGER_INTERNAL_PREFIX)) {
                internalMessages.push(msg.text())
            }
        })

        await use()

        expect(
            internalMessages,
            `Frogger emitted internal console output during this test:\n${internalMessages.join('\n')}`,
        ).toEqual([])
    },
})

export { expect }
