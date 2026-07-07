import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { useEvent } from 'nitropack/runtime/internal/context'

import { ServerFroggerLogger } from '../../logger/server'
import { createAmbientFrogger } from '../../logger/ambient'
import type { FroggerAmbient } from '../../logger/ambient'

import type { IFroggerLogger } from '../../logger/types'
import type { TraceContext } from '../../shared/types/trace-headers'
import type { ServerLoggerOptions } from '../types/logger'

// Reused when `frogger` is called outside a request (startup, tasks, background)
// where there is no H3 event to scope to. Lazily created; its own fresh trace.
let fallbackLogger: IFroggerLogger | null = null

function buildServerLogger(event?: H3Event): IFroggerLogger {
    const config = useRuntimeConfig()

    const froggerOptions = {
        //@ts-ignore - runtime config is untyped
        file: config.frogger.file,
        //@ts-ignore
        batch: config.public.frogger.batch,
        //@ts-ignore
        endpoint: config.public.frogger.endpoint,
    } as ServerLoggerOptions

    // event.context.frogger is populated by the trace-headers server plugin from
    // the incoming traceparent, so the first server log continues the client trace.
    const traceContext = event?.context?.frogger as TraceContext | undefined

    return traceContext
        ? new ServerFroggerLogger(froggerOptions, traceContext)
        : new ServerFroggerLogger(froggerOptions)
}

function getAmbientServerLogger(): IFroggerLogger {
    let event: H3Event | undefined
    try {
        // Resolved via Nitro asyncContext (enabled when autoEventCapture is on,
        // the default). Throws outside a request — handled below.
        event = useEvent()
    }
    catch {
        event = undefined
    }

    if (event) {
        const ctx = event.context as Record<string, any>
        // Cache ONE logger per request so all `frogger.*` calls in that request
        // advance a single span chain (and consume the incoming trace once).
        if (!ctx.froggerAmbientLogger) {
            ctx.froggerAmbientLogger = buildServerLogger(event)
        }
        return ctx.froggerAmbientLogger as IFroggerLogger
    }

    if (!fallbackLogger) {
        fallbackLogger = buildServerLogger(undefined)
    }
    return fallbackLogger
}

/**
 * Ambient, zero-ceremony logger — a drop-in for `console.*` in Nitro server
 * routes and utils.
 *
 * ```ts
 * frogger.info('order created', { orderId })
 * frogger.error('payment failed', err)
 * ```
 *
 * Backed by a single per-request {@link ServerFroggerLogger} (resolved via
 * `useEvent()`), so all calls in a request form ONE span chain and stay
 * correlated with the client's trace. Reach for `getFrogger(event)` when you
 * want a fresh/independent span or to pass the event explicitly.
 *
 * Note: per-request scoping relies on `serverModule.autoEventCapture` (on by
 * default). With it disabled, `frogger` falls back to a process-scoped logger
 * without per-request trace correlation — use `getFrogger(event)` there.
 */
export const frogger: FroggerAmbient = createAmbientFrogger(getAmbientServerLogger)
