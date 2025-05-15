import { H3Event } from "h3";
import { uuidv7 } from "../../shared/utils/uuid";
import { getHeader, setHeader } from "#imports";



export function setTracingHeaders(event: H3Event) {
    let traceId = getHeader(event, 'x-trace-id');
    
    if (!traceId) {
        traceId = `req_${uuidv7()}`;;
    }

    setHeader(event, 'x-trace-id', traceId);
    event.node.res.setHeader('x-trace-id', traceId);
    event.context.traceId = traceId;


    // Session tracing
    // const sessionTraceId = getHeader(event, 'x-session-trace-id');
    // event.context.sessionTraceId = sessionTraceId;
    // if (!sessionTraceId) {
    //     event.node.res.setHeader('x-session-trace-id', traceId);
    // }

    console.log('setting tracing headers', {
        traceId,
        // sessionTraceId,
        event: event.node.req.url,
    })
}