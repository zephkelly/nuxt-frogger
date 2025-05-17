import { randomBytes } from 'crypto';

/**
 * Generate a trace ID according to W3C Trace Context spec
 * A trace ID is a 16-byte array represented as a 32-character hex string
 * 
 * @returns A 32-character hex string trace ID
 */
export function generateTraceId(): string {
    // In browser environments, we'll fallback to Math.random if crypto is not available
    if (typeof window !== 'undefined' && !crypto.randomUUID) {
        return generateRandomHexString(32);
    }
    
    // In Node.js or modern browsers with crypto support
    return randomBytes(16).toString('hex');
}

/**
 * Generate a span ID according to W3C Trace Context spec
 * A span ID is an 8-byte array represented as a 16-character hex string
 * 
 * @returns A 16-character hex string span ID
 */
export function generateSpanId(): string {
    // In browser environments, we'll fallback to Math.random if crypto is not available
    if (typeof window !== 'undefined' && !crypto.randomUUID) {
        return generateRandomHexString(16);
    }
    
    // In Node.js or modern browsers with crypto support
    return randomBytes(8).toString('hex');
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
 * Parse a traceparent header and extract its components
 * Format: 00-<trace-id>-<parent-id>-<trace-flags>
 * 
 * @returns Parsed components or null if invalid
 */
export function parseTraceparent(header: string): {
    version: string;
    traceId: string;
    parentId: string;
    flags: string;
} | null {
    if (!header) {
        return null;
    }
    
    // Check the format using regex
    const match = header.match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
    if (!match) {
        return null;
    }
    
    const [_, version, traceId, parentId, flags] = match;
    
    // Validate the trace ID and span ID
    if (!isValidTraceId(traceId) || !isValidSpanId(parentId)) {
        return null;
    }
    
    return {
        version,
        traceId,
        parentId,
        flags
    };
}

/**
 * Create a W3C-compliant traceparent header
 */
export function createTraceparent(
    traceId: string = generateTraceId(),
    spanId: string = generateSpanId(),
    sampled: boolean = true
): string {
    // Ensure we have valid IDs
    if (!isValidTraceId(traceId)) {
        traceId = generateTraceId();
    }
    
    if (!isValidSpanId(spanId)) {
        spanId = generateSpanId();
    }
    
    // Create the header
    // version=00, flags=01 for sampled, 00 for not sampled
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}