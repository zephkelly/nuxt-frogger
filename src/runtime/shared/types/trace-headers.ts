/**
 * Trace context following W3C Trace Context specification
 */
export interface TraceContext {
    /**
     * Trace ID - unique identifier for the whole trace
     * 16-byte array as 32-character hex string
     */
    traceId: string;
    
    /**
     * Span ID - unique identifier for this specific operation
     * 8-byte array as 16-character hex string
     */
    spanId: string;
    
    /**
     * Parent Span ID - the span that CREATED this one.
     *
     * Renamed from `parentId` in 0.2.0, along with the semantics: it used to
     * mean "the log row emitted immediately before this one on this instance",
     * which is not a parent edge and made the tree order-dependent. It now
     * names the unit of work that contains this span.
     */
    parentSpanId?: string;

    /** W3C trace-flags byte, e.g. `'01'` for sampled. */
    flags?: string;
}

export interface W3CTraceHeaders {
    traceparent: string;
    tracestate?: string;
}