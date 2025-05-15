import { H3Event } from 'h3';

import {
    requestTraceIdSchema,
    sessionTraceIdSchema,
} from '../../shared/schemas/trace-ids';

import {
    type RequestTraceId,
    type SessionTraceId,
} from '../../shared/types/trace-ids';



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