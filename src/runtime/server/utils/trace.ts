import { H3Event } from 'h3';

import {
    type RequestTraceId,
    requestTraceIdSchema,

    type SessionTraceId,
    sessionTraceIdSchema,
} from '../../shared/types/ids';



export function getTraceId(event: H3Event): RequestTraceId {
    const traceId = event.context.traceId;
    
    const parsedTraceId = requestTraceIdSchema.safeParse(traceId);
    if (!parsedTraceId.success) {
        throw new Error('Trace ID not found in event context');
    }

    return parsedTraceId.data;
}

export function getSessionTraceId(event: H3Event): SessionTraceId {
    const sessionTraceId = event.context.sessionTraceId;
    
    const parsedSessionTraceId = sessionTraceIdSchema.safeParse(sessionTraceId);
    if (!parsedSessionTraceId.success) {
        throw new Error('Session Trace ID not found in event context');
    }

    return parsedSessionTraceId.data;
}