import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    generateTraceId,
    generateSpanId,
    isValidTraceId,
    isValidSpanId,
    createTraceparent,
    parseTraceparent,
    createTracestate,
    parseTracestate,
    generateW3CTraceHeaders,
    extractTraceContext
} from '../src/runtime/shared/utils/trace-headers';

describe('trace-headers utilities', () => {
    describe('generateTraceId', () => {
        it('should generate a 32-character hex string', () => {
            const traceId = generateTraceId();

            expect(traceId).toHaveLength(32);
            expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        });

        it('should generate unique trace IDs', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                ids.add(generateTraceId());
            }

            expect(ids.size).toBe(100);
        });

        it('should not generate all-zero trace ID', () => {
            for (let i = 0; i < 50; i++) {
                const traceId = generateTraceId();
                expect(traceId).not.toBe('00000000000000000000000000000000');
            }
        });
    });

    describe('generateSpanId', () => {
        it('should generate a 16-character hex string', () => {
            const spanId = generateSpanId();

            expect(spanId).toHaveLength(16);
            expect(spanId).toMatch(/^[0-9a-f]{16}$/);
        });

        it('should generate unique span IDs', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                ids.add(generateSpanId());
            }

            expect(ids.size).toBe(100);
        });

        it('should not generate all-zero span ID', () => {
            for (let i = 0; i < 50; i++) {
                const spanId = generateSpanId();
                expect(spanId).not.toBe('0000000000000000');
            }
        });
    });

    describe('isValidTraceId', () => {
        it('should validate correct trace ID', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            expect(isValidTraceId(traceId)).toBe(true);
        });

        it('should reject trace ID with wrong length', () => {
            expect(isValidTraceId('a1b2c3d4')).toBe(false);
            expect(isValidTraceId('a1b2c3d4e5f67890abcdef1234567890ff')).toBe(false);
        });

        it('should reject all-zero trace ID', () => {
            expect(isValidTraceId('00000000000000000000000000000000')).toBe(false);
        });

        it('should reject non-hex characters', () => {
            expect(isValidTraceId('g1b2c3d4e5f67890abcdef1234567890')).toBe(false);
            expect(isValidTraceId('a1b2c3d4e5f67890abcdef123456789Z')).toBe(false);
        });

        it('should reject uppercase hex characters', () => {
            expect(isValidTraceId('A1B2C3D4E5F67890ABCDEF1234567890')).toBe(false);
        });

        it('should reject null or undefined', () => {
            expect(isValidTraceId(null as any)).toBe(false);
            expect(isValidTraceId(undefined as any)).toBe(false);
        });

        it('should reject non-string values', () => {
            expect(isValidTraceId(123 as any)).toBe(false);
            expect(isValidTraceId({} as any)).toBe(false);
        });

        it('should reject empty string', () => {
            expect(isValidTraceId('')).toBe(false);
        });
    });

    describe('isValidSpanId', () => {
        it('should validate correct span ID', () => {
            const spanId = 'a1b2c3d4e5f67890';
            expect(isValidSpanId(spanId)).toBe(true);
        });

        it('should reject span ID with wrong length', () => {
            expect(isValidSpanId('a1b2c3d4')).toBe(false);
            expect(isValidSpanId('a1b2c3d4e5f67890ff')).toBe(false);
        });

        it('should reject all-zero span ID', () => {
            expect(isValidSpanId('0000000000000000')).toBe(false);
        });

        it('should reject non-hex characters', () => {
            expect(isValidSpanId('g1b2c3d4e5f67890')).toBe(false);
            expect(isValidSpanId('a1b2c3d4e5f6789Z')).toBe(false);
        });

        it('should reject uppercase hex characters', () => {
            expect(isValidSpanId('A1B2C3D4E5F67890')).toBe(false);
        });

        it('should reject null or undefined', () => {
            expect(isValidSpanId(null as any)).toBe(false);
            expect(isValidSpanId(undefined as any)).toBe(false);
        });

        it('should reject non-string values', () => {
            expect(isValidSpanId(123 as any)).toBe(false);
            expect(isValidSpanId({} as any)).toBe(false);
        });

        it('should reject empty string', () => {
            expect(isValidSpanId('')).toBe(false);
        });
    });

    describe('createTraceparent', () => {
        it('should create valid traceparent with default parameters', () => {
            const traceparent = createTraceparent();

            expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
        });

        it('should create traceparent with provided trace ID and span ID', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const spanId = 'a1b2c3d4e5f67890';

            const traceparent = createTraceparent(traceId, spanId);

            expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);
        });

        it('should set sampled flag correctly', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const spanId = 'a1b2c3d4e5f67890';

            const sampledTrue = createTraceparent(traceId, spanId, true);
            const sampledFalse = createTraceparent(traceId, spanId, false);

            expect(sampledTrue).toContain('-01');
            expect(sampledFalse).toContain('-00');
        });

        it('should generate new trace ID if invalid one is provided', () => {
            const invalidTraceId = 'invalid';
            const spanId = 'a1b2c3d4e5f67890';

            const traceparent = createTraceparent(invalidTraceId, spanId);

            expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
            expect(traceparent).not.toContain('invalid');
        });

        it('should generate new span ID if invalid one is provided', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const invalidSpanId = 'invalid';

            const traceparent = createTraceparent(traceId, invalidSpanId);

            expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
            expect(traceparent).not.toContain('invalid');
        });

        it('should handle all-zero IDs by generating new ones', () => {
            const allZeroTraceId = '00000000000000000000000000000000';
            const allZeroSpanId = '0000000000000000';

            const traceparent = createTraceparent(allZeroTraceId, allZeroSpanId);

            expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
            expect(traceparent).not.toContain(allZeroTraceId);
            expect(traceparent).not.toContain(allZeroSpanId);
        });
    });

    describe('parseTraceparent', () => {
        it('should parse valid traceparent header', () => {
            const traceparent = '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01';
            const result = parseTraceparent(traceparent);

            expect(result).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '01'
            });
        });

        it('should parse traceparent with not-sampled flag', () => {
            const traceparent = '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-00';
            const result = parseTraceparent(traceparent);

            expect(result).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '00'
            });
        });

        it('should return null for empty string', () => {
            expect(parseTraceparent('')).toBeNull();
        });

        it('should return null for null or undefined', () => {
            expect(parseTraceparent(null as any)).toBeNull();
            expect(parseTraceparent(undefined as any)).toBeNull();
        });

        it('should return null for invalid format (wrong number of parts)', () => {
            expect(parseTraceparent('00-a1b2c3d4')).toBeNull();
            expect(parseTraceparent('00-a1b2c3d4-e5f67890')).toBeNull();
            expect(parseTraceparent('00-a1b2-c3d4-e5f6-7890')).toBeNull();
        });

        it('should return null for unsupported version', () => {
            const traceparent = '01-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01';
            expect(parseTraceparent(traceparent)).toBeNull();
        });

        it('should handle traceparent with different flag values', () => {
            const traceparent = '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-ff';
            const result = parseTraceparent(traceparent);

            expect(result).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: 'ff'
            });
        });
    });

    describe('createTracestate', () => {
        it('should create tracestate from vendor data', () => {
            const vendorData = {
                'vendor1': 'value1',
                'vendor2': 'value2'
            };

            const tracestate = createTracestate(vendorData);

            expect(tracestate).toBe('vendor1=value1,vendor2=value2');
        });

        it('should return undefined for empty vendor data', () => {
            expect(createTracestate({})).toBeUndefined();
        });

        it('should return undefined when no vendor data provided', () => {
            expect(createTracestate()).toBeUndefined();
        });

        it('should handle single vendor entry', () => {
            const vendorData = { 'myvendor': 'myvalue' };
            const tracestate = createTracestate(vendorData);

            expect(tracestate).toBe('myvendor=myvalue');
        });

        it('should handle vendor data with special characters in values', () => {
            const vendorData = {
                'vendor1': 'value-with-dashes',
                'vendor2': 'value_with_underscores'
            };

            const tracestate = createTracestate(vendorData);

            expect(tracestate).toContain('vendor1=value-with-dashes');
            expect(tracestate).toContain('vendor2=value_with_underscores');
        });
    });

    describe('parseTracestate', () => {
        it('should parse tracestate header', () => {
            const tracestate = 'vendor1=value1,vendor2=value2';
            const result = parseTracestate(tracestate);

            expect(result).toEqual({
                'vendor1': 'value1',
                'vendor2': 'value2'
            });
        });

        it('should return empty object for empty string', () => {
            expect(parseTracestate('')).toEqual({});
        });

        it('should return empty object for null or undefined', () => {
            expect(parseTracestate(null as any)).toEqual({});
            expect(parseTracestate(undefined as any)).toEqual({});
        });

        it('should handle single vendor entry', () => {
            const tracestate = 'myvendor=myvalue';
            const result = parseTracestate(tracestate);

            expect(result).toEqual({ 'myvendor': 'myvalue' });
        });

        it('should trim whitespace around entries', () => {
            const tracestate = 'vendor1=value1 , vendor2=value2 , vendor3=value3';
            const result = parseTracestate(tracestate);

            expect(result).toEqual({
                'vendor1': 'value1',
                'vendor2': 'value2',
                'vendor3': 'value3'
            });
        });

        it('should skip invalid entries without equals sign', () => {
            const tracestate = 'vendor1=value1,invalidentry,vendor2=value2';
            const result = parseTracestate(tracestate);

            expect(result).toEqual({
                'vendor1': 'value1',
                'vendor2': 'value2'
            });
        });

        it('should handle values with special characters', () => {
            const tracestate = 'vendor1=value-with-dashes,vendor2=value_with_underscores';
            const result = parseTracestate(tracestate);

            expect(result).toEqual({
                'vendor1': 'value-with-dashes',
                'vendor2': 'value_with_underscores'
            });
        });
    });

    describe('generateW3CTraceHeaders', () => {
        it('should generate headers with default options', () => {
            const headers = generateW3CTraceHeaders({});

            expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
            expect(headers.tracestate).toBeUndefined();
        });

        it('should use provided trace ID', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const headers = generateW3CTraceHeaders({ traceId });

            expect(headers.traceparent).toContain(traceId);
        });

        it('should use provided parent span ID', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const parentSpanId = 'b1c2d3e4f5a67890';
            const headers = generateW3CTraceHeaders({ traceId, parentSpanId });

            expect(headers.traceparent).toContain(parentSpanId);
        });

        it('should generate new span ID if parent span ID is not provided', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const headers = generateW3CTraceHeaders({ traceId });

            expect(headers.traceparent).toMatch(/^00-a1b2c3d4e5f67890abcdef1234567890-[0-9a-f]{16}-01$/);
        });

        it('should include tracestate when vendor data is provided', () => {
            const vendorData = { 'vendor1': 'value1', 'vendor2': 'value2' };
            const headers = generateW3CTraceHeaders({ vendorData });

            expect(headers.tracestate).toBe('vendor1=value1,vendor2=value2');
        });

        it('should respect sampled flag', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';

            const sampledTrue = generateW3CTraceHeaders({ traceId, sampled: true });
            const sampledFalse = generateW3CTraceHeaders({ traceId, sampled: false });

            expect(sampledTrue.traceparent).toContain('-01');
            expect(sampledFalse.traceparent).toContain('-00');
        });

        it('should generate complete headers with all options', () => {
            const options = {
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                parentSpanId: 'b1c2d3e4f5a67890',
                vendorData: { 'myvendor': 'myvalue' },
                sampled: true
            };

            const headers = generateW3CTraceHeaders(options);

            expect(headers.traceparent).toBe('00-a1b2c3d4e5f67890abcdef1234567890-b1c2d3e4f5a67890-01');
            expect(headers.tracestate).toBe('myvendor=myvalue');
        });
    });

    describe('extractTraceContext', () => {
        it('should extract trace context from headers with lowercase keys', () => {
            const headers = {
                'traceparent': '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01'
            };

            const context = extractTraceContext(headers);

            expect(context).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '01'
            });
        });

        it('should extract trace context from headers with capitalized keys', () => {
            const headers = {
                'Traceparent': '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01'
            };

            const context = extractTraceContext(headers);

            expect(context).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '01'
            });
        });

        it('should return null when traceparent header is missing', () => {
            const headers = {};
            expect(extractTraceContext(headers)).toBeNull();
        });

        it('should return null when traceparent is invalid', () => {
            const headers = {
                'traceparent': 'invalid-traceparent'
            };

            expect(extractTraceContext(headers)).toBeNull();
        });

        it('should extract context with tracestate present', () => {
            const headers = {
                'traceparent': '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01',
                'tracestate': 'vendor1=value1,vendor2=value2'
            };

            const context = extractTraceContext(headers);

            expect(context).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '01'
            });
        });

        it('should handle mixed case header keys', () => {
            const headers = {
                'Traceparent': '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-01',
                'Tracestate': 'vendor1=value1'
            };

            const context = extractTraceContext(headers);

            expect(context).not.toBeNull();
            expect(context?.traceId).toBe('a1b2c3d4e5f67890abcdef1234567890');
        });

        it('should handle empty headers object', () => {
            expect(extractTraceContext({})).toBeNull();
        });

        it('should extract context with not-sampled flag', () => {
            const headers = {
                'traceparent': '00-a1b2c3d4e5f67890abcdef1234567890-a1b2c3d4e5f67890-00'
            };

            const context = extractTraceContext(headers);

            expect(context).toEqual({
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                spanId: 'a1b2c3d4e5f67890',
                flags: '00'
            });
        });
    });

    describe('integration scenarios', () => {
        it('should create and parse traceparent round-trip', () => {
            const traceId = 'a1b2c3d4e5f67890abcdef1234567890';
            const spanId = 'a1b2c3d4e5f67890';

            const traceparent = createTraceparent(traceId, spanId, true);
            const parsed = parseTraceparent(traceparent);

            expect(parsed).toEqual({
                traceId,
                spanId,
                flags: '01'
            });
        });

        it('should create and parse tracestate round-trip', () => {
            const vendorData = {
                'vendor1': 'value1',
                'vendor2': 'value2'
            };

            const tracestate = createTracestate(vendorData);
            const parsed = parseTracestate(tracestate!);

            expect(parsed).toEqual(vendorData);
        });

        it('should generate headers and extract context', () => {
            const options = {
                traceId: 'a1b2c3d4e5f67890abcdef1234567890',
                parentSpanId: 'b1c2d3e4f5a67890',
                sampled: true
            };

            const headers = generateW3CTraceHeaders(options);
            const context = extractTraceContext({
                'traceparent': headers.traceparent
            });

            expect(context).toEqual({
                traceId: options.traceId,
                spanId: options.parentSpanId,
                flags: '01'
            });
        });

        it('should handle complete trace propagation scenario', () => {
            // Service A generates trace headers
            const serviceAHeaders = generateW3CTraceHeaders({
                vendorData: { 'service-a': 'metadata' },
                sampled: true
            });

            if (!serviceAHeaders.tracestate) {
                throw new Error('tracestate header is missing');
            }

            // Service B receives and extracts context
            const serviceBContext = extractTraceContext({
                'traceparent': serviceAHeaders.traceparent,
                'tracestate': serviceAHeaders.tracestate
            });

            expect(serviceBContext).not.toBeNull();
            expect(serviceBContext?.traceId).toMatch(/^[0-9a-f]{32}$/);

            // Service B creates new span with same trace ID
            const serviceBHeaders = generateW3CTraceHeaders({
                traceId: serviceBContext!.traceId,
                parentSpanId: serviceBContext!.spanId,
                vendorData: { 'service-b': 'metadata' },
                sampled: true
            });

            expect(serviceBHeaders.traceparent).toContain(serviceBContext!.traceId);
            expect(serviceBHeaders.traceparent).toContain(serviceBContext!.spanId);
        });
    });
});
