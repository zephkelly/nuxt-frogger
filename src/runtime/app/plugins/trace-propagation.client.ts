import { defineNuxtPlugin } from '#app'

import { getAmbientClientLogger } from '../frogger'
import { getActiveLogger } from '../../logger/active-context.client'
import { useFroggerConfig } from '../../shared/utils/use-frogger-config'
import { froggerInternal } from '../../shared/utils/internal-log'
import { shouldPropagateTrace, urlOf } from '../../shared/utils/trace-propagation'

/**
 * Attach W3C trace headers to same-origin `$fetch` calls, so a browser action
 * and the server work it triggers land on one trace without the caller
 * threading `getHeaders()` through by hand.
 *
 * Scoped to the CLIENT only. The server-to-server case looks similar and is
 * not: `globalThis.$fetch` is process-shared there, so per-request header
 * injection needs the AsyncLocalStorage context, and getting it wrong leaks one
 * request's trace id into another request's outbound call.
 *
 * Opt out per call with `$fetch(url, { frogger: false })`.
 */
export default defineNuxtPlugin({
    name: 'frogger:trace-propagation',
    setup(nuxtApp) {
        if (!import.meta.client) return

        const option = useFroggerConfig().tracePropagation
        if (option === false) return

        nuxtApp.hook('app:created', () => {
            // No-op if the hook host is unavailable; propagation is a
            // convenience, never a requirement.
        })

        const globalFetch = globalThis.$fetch as unknown as {
            create?: unknown
            _froggerPatched?: boolean
        } | undefined

        if (!globalFetch || globalFetch._froggerPatched) return

        try {
            installInterceptor(option)
            globalFetch._froggerPatched = true
        }
        catch (err) {
            froggerInternal.error('Trace propagation: failed to install interceptor', err)
        }
    },
})

function installInterceptor(option: ReturnType<typeof useFroggerConfig>['tracePropagation']): void {
    const original = globalThis.$fetch as unknown as ((...args: unknown[]) => unknown) & {
        raw?: (...args: unknown[]) => unknown
        create?: (...args: unknown[]) => unknown
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : ''

    const withTraceHeaders = (request: unknown, options: Record<string, unknown> = {}) => {
        // Per-call escape hatch.
        if (options.frogger === false) return options

        const url = urlOf(request)
        if (!shouldPropagateTrace(url, origin, option)) return options

        try {
            // The ACTIVE span wins over the app-scoped logger, so a call made
            // inside `frogger.span()` is parented under that span rather than
            // under the page.
            const logger = getActiveLogger() ?? getAmbientClientLogger()
            if (!logger) return options

            const headers = logger.getHeaders()

            return {
                ...options,
                // Caller headers win: this must never clobber an Authorization
                // or Content-Type the app set deliberately.
                headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
            }
        }
        catch {
            return options
        }
    }

    const patched = ((request: unknown, options?: Record<string, unknown>) =>
        original(request, withTraceHeaders(request, options))) as typeof original

    if (original.raw) {
        patched.raw = ((request: unknown, options?: Record<string, unknown>) =>
            original.raw!(request, withTraceHeaders(request, options))) as typeof original.raw
    }
    if (original.create) {
        patched.create = original.create.bind(original)
    }

    globalThis.$fetch = patched as typeof globalThis.$fetch
}
