// export function tryGetTraceHeaders(headers: Headers): TraceHeaders {
//     const traceparent = headers.get("traceparent");
//     const tracestate = headers.get("tracestate");

//     if (!traceparent) {
//         return {};
//     }

//     const parsedTraceparent = parseTraceparent(traceparent);
//     if (!parsedTraceparent) {
//         return {};
//     }

//     const traceHeaders: TraceHeaders = {
//         traceId: parsedTraceparent.traceId,
//         parentId: parsedTraceparent.parentId,
//         flags: parsedTraceparent.flags,
//     };

//     if (tracestate) {
//         traceHeaders.tracestate = tracestate;
//     }

//     return traceHeaders;
// }