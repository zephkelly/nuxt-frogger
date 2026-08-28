import type { IFroggerLogger } from '../../../logger/types'
import { parseTraceparent } from '../../../shared/utils/trace-headers'

/**
 * Best-effort `{traceId, spanId}` exemplar from a logger's W3C headers.
 *
 * The span id is whatever the logger last emitted, so a metric recorded before
 * a span's first log points at the parent span rather than the span itself.
 * That is an exemplar, not a foreign key, so the trace is still correct.
 */
export function traceFromLogger(logger: IFroggerLogger): { traceId: string, spanId?: string } | undefined {
    try {
        const traceparent = logger.getHeaders().traceparent
        if (!traceparent) return undefined
        const parsed = parseTraceparent(traceparent)
        if (parsed) return { traceId: parsed.traceId, spanId: parsed.spanId }
    }
    catch {
        // A logger without trace headers simply yields no exemplar.
    }
    return undefined
}
