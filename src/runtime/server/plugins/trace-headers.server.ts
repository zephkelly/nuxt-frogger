import { H3Event, getRequestHeaders  } from 'h3';

import { generateSpanId, generateTraceId } from '../../shared/utils/trace-headers';
import type { TraceContext } from '../../shared/types/trace-headers';

//@ts-ignore
// import { defineNitroPlugin } from '#imports';

//@ts-ignore
export default defineNitroPlugin((nitroApp) => {

    nitroApp.hooks.hook('request', (event: H3Event) => {
        const headers = getRequestHeaders(event)
        const traceparent = headers.traceparent
        let traceId, parentSpanId
        
        if (traceparent) {
            try {
                const parts = traceparent.split('-')
                if (parts.length === 4) {
                    traceId = parts[1]
                    parentSpanId = parts[2]
                }
            }
            catch (e) { }
        }

        const newStartingTraceContext: TraceContext = {
            traceId: traceId || generateTraceId(),
            spanId: generateSpanId(),
            parentId: parentSpanId
        }
        
        event.context.frogger = newStartingTraceContext
    });

});