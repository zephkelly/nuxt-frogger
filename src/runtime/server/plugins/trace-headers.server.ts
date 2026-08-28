import { H3Event, getRequestHeaders } from 'h3';

import { extractTraceContext, generateSpanId, generateTraceId } from '../../shared/utils/trace-headers';
import { parseSessionHeader } from '../../shared/session';
import type { TraceContext } from '../../shared/types/trace-headers';

//@ts-ignore
import { defineNitroPlugin } from '#imports';

/**
 * Seed each request's trace context from the inbound W3C headers.
 *
 * Parsing goes through `extractTraceContext`, which validates the id shapes:
 * the hand-rolled split this replaced adopted whatever an untrusted peer sent,
 * including malformed and all-zero ids, as the trace every row on the request
 * would carry.
 */
//@ts-ignore
export default defineNitroPlugin((nitroApp) => {

    nitroApp.hooks.hook('request', (event: H3Event) => {
        const headers = getRequestHeaders(event) as Record<string, string>;
        const incoming = extractTraceContext(headers);

        const newStartingTraceContext: TraceContext = {
            traceId: incoming?.traceId || generateTraceId(),
            spanId: generateSpanId(),
            parentSpanId: incoming?.spanId,
            // The upstream's sampling decision, carried so `getHeaders()` can
            // re-emit it instead of fabricating a fresh '01' on every hop.
            // Absent means "nobody has decided": frogger propagates decisions,
            // it does not make them.
            flags: incoming?.flags ?? '01',
        };

        event.context.frogger = newStartingTraceContext;
        // Unvalidated client input, so it gets the same shape-check and length
        // cap as a trace id before anything indexes on it.
        event.context.froggerSession = parseSessionHeader(headers['x-frogger-session']);
        // Kept separate from the trace context: it is vendor state to carry
        // forward, not part of this span's identity.
        event.context.froggerTracestate = headers.tracestate || headers.Tracestate;
    });

});
