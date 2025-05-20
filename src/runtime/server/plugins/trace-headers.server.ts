import { H3Event, getRequestHeaders  } from 'h3';

import { generateTraceId } from '../../shared/utils/tracing';

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
        
        event.context.frogger = {
            traceId: traceId || generateTraceId(),
            parentSpanId
        }
    });

});