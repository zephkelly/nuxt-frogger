import { H3Event } from 'h3';


export function getTraceId(event: H3Event) {
    const traceId = event.context.traceId;
    if (!traceId) {
        throw new Error('Trace ID not found in event context');
    }

    return traceId;
}

export function getSessionTraceId(event: H3Event) {
    const sessionTraceId = event.context.sessionTraceId;
    if (!sessionTraceId) {
        throw new Error('Session Trace ID not found in event context');
    }

    return sessionTraceId;
}