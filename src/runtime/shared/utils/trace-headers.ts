import type { TraceContext, W3CTraceHeaders } from "../types/trace-headers";

/**
 * Generate a trace ID according to W3C Trace Context spec
 * A trace ID is a 16-byte array represented as a 32-character hex string
 *
 * @returns A 32-character hex string trace ID
 */
export function generateTraceId(): string {
  // Browser environment with Web Crypto API
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const buffer = new Uint8Array(16);
    window.crypto.getRandomValues(buffer);
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  
  // Fallback for environments without crypto
  return generateRandomHexString(32);
}

/**
 * Generate a span ID according to W3C Trace Context spec
 * A span ID is an 8-byte array represented as a 16-character hex string
 *
 * @returns A 16-character hex string span ID
 */
export function generateSpanId(): string {
  // Browser environment with Web Crypto API
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const buffer = new Uint8Array(8);
    window.crypto.getRandomValues(buffer);
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback for environments without crypto
  return generateRandomHexString(16);
}

/**
 * Fallback method to generate random hex strings when crypto is not available
 * Note: This is less secure than using crypto, but works in all environments
 */
function generateRandomHexString(length: number): string {
  const hex = '0123456789abcdef';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += hex[Math.floor(Math.random() * 16)];
  }
  
  return result;
}

/**
 * Validate a trace ID according to W3C Trace Context spec
 * A valid trace ID is a 32-character hex string that is not all zeros
 */
export function isValidTraceId(traceId: string): boolean {
  if (!traceId || typeof traceId !== 'string') {
    return false;
  }
  
  // Must be 32 hex characters
  if (!traceId.match(/^[0-9a-f]{32}$/)) {
    return false;
  }
  
  // Must not be all zeros
  if (traceId === '00000000000000000000000000000000') {
    return false;
  }
  
  return true;
}

/**
 * Validate a span ID according to W3C Trace Context spec
 * A valid span ID is a 16-character hex string that is not all zeros
 */
export function isValidSpanId(spanId: string): boolean {
  if (!spanId || typeof spanId !== 'string') {
    return false;
  }
  
  // Must be 16 hex characters
  if (!spanId.match(/^[0-9a-f]{16}$/)) {
    return false;
  }
  
  // Must not be all zeros
  if (spanId === '0000000000000000') {
    return false;
  }
  
  return true;
}


/**
 * Create a W3C-compliant traceparent header
 */
export function createTraceparent(
  traceId: string = generateTraceId(),
  spanId: string = generateSpanId(),
  sampled: boolean = true
): string {
    if (!isValidTraceId(traceId)) {
        traceId = generateTraceId();
    }
    
    if (!isValidSpanId(spanId)) {
        spanId = generateSpanId();
    }
    
    // version=00, flags=01 for sampled, 00 for not sampled
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

/**
 * Parse a traceparent header and extract its components
 * Format: 00-<trace-id>-<parent-id>-<trace-flags>
 *
 * @returns Parsed components or null if invalid
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
    if (!traceparent) return null;

    const parts = traceparent.split('-');
    if (parts.length !== 4) return null;

    const [version, traceId, spanId, flags] = parts;

    if (version !== '00') return null;

    // Ids come from an untrusted peer. An invalid one must not be adopted as
    // this request's trace: a malformed or all-zero id would poison every row
    // that continues from it.
    if (!isValidTraceId(traceId!) || !isValidSpanId(spanId!)) return null;

    // Flags are exactly two hex digits per the spec; anything else is dropped
    // rather than propagated onward as a malformed header.
    const validFlags = typeof flags === 'string' && /^[0-9a-f]{2}$/.test(flags)
        ? flags
        : undefined;

    return {
        traceId: traceId!,
        spanId: spanId!,
        ...(validFlags !== undefined && { flags: validFlags }),
    };
}

/** Whether a trace-flags byte has the `sampled` bit set. */
export function isSampled(flags: string | undefined): boolean {
    if (!flags) return true;
    return (Number.parseInt(flags, 16) & 0x01) === 0x01;
}


/**
 * Create a W3C-compliant tracestate header
 * Format: vendorkey1=value1,vendorkey2=value2
 *
 * @param vendorData - Object containing vendor-specific data
 * @returns A tracestate string or undefined if no data provided
 */
export function createTracestate(
    vendorData: Record<string, string> = {}
): string | undefined {
    if (Object.keys(vendorData).length === 0) {
        return undefined;
    }
    
    const entries = Object.entries(vendorData)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
    
    return entries;
}

/**
 * Parse W3C tracestate header
 * Format: vendorkey1=value1,vendorkey2=value2
 */
export function parseTracestate(tracestate: string): Record<string, string> {
    if (!tracestate) return {};
    
    const result: Record<string, string> = {};
    
    tracestate.split(',').forEach(pair => {
        const [key, value] = pair.trim().split('=');
        if (key && value) {
            result[key] = value;
        }
    });
    
    return result;
}



/**
 * Generate W3C-compliant trace headers
 */
export function generateW3CTraceHeaders(options: {
    traceId?: string;
    parentSpanId?: string;
    vendorData?: Record<string, string>;
    sampled?: boolean;
    /**
     * The trace-flags byte to re-emit. Set this to propagate an upstream
     * sampling decision verbatim; it wins over `sampled`, which only
     * synthesises one. Frogger propagates a decision, it does not make one.
     */
    flags?: string;
    /** Incoming `tracestate` to carry forward, with frogger's entry prepended. */
    inboundTracestate?: string;
}): W3CTraceHeaders {
    const {
        traceId = generateTraceId(),
        parentSpanId,
        vendorData = {},
        sampled = true,
        flags: suppliedFlags,
        inboundTracestate,
    } = options;

    const newSpanId = generateSpanId();
    const flags = suppliedFlags && /^[0-9a-f]{2}$/.test(suppliedFlags)
        ? suppliedFlags
        : (sampled ? '01' : '00');

    const traceparent = `00-${traceId}-${parentSpanId ? parentSpanId : newSpanId}-${flags}`;

    const tracestate = mergeTracestate(vendorData, inboundTracestate);

    return {
        traceparent,
        tracestate
    };
}

/**
 * Prepend this hop's vendor entries to an inbound `tracestate`, dropping any
 * stale entry for a key we are re-writing. W3C puts the most recent mutator
 * first, and caps the list at 32 entries.
 */
export function mergeTracestate(
    vendorData: Record<string, string> = {},
    inbound?: string,
): string | undefined {
    const own = createTracestate(vendorData);
    if (!inbound) return own;

    const ownKeys = new Set(Object.keys(vendorData));
    const carried = inbound
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0 && !ownKeys.has(entry.split('=')[0]!));

    const entries = [...(own ? [own] : []), ...carried].slice(0, 32);
    return entries.length > 0 ? entries.join(',') : undefined;
}


/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers: Record<string, string>): TraceContext | null {
    const traceparent = headers['traceparent'] || headers['Traceparent'];
    if (!traceparent) return null;

    return parseTraceparent(traceparent);
}