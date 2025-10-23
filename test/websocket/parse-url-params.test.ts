import { describe, it, expect } from 'vitest';
import { parseUrlParams } from '../../src/runtime/websocket/utils/parse-url-params';

describe('parseUrlParams', () => {
    describe('channel parameter', () => {
        it('should parse channel parameter', () => {
            const url = new URL('ws://localhost?channel=main');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toBeUndefined();
        });

        it('should return undefined when channel is not provided', () => {
            const url = new URL('ws://localhost');
            const result = parseUrlParams(url);

            expect(result.channel).toBeUndefined();
            expect(result.filters).toBeUndefined();
        });

        it('should handle channel with special characters', () => {
            const url = new URL('ws://localhost?channel=my-channel_123');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('my-channel_123');
        });
    });

    describe('JSON filters parameter', () => {
        it('should parse JSON filters with level', () => {
            const url = new URL('ws://localhost?channel=main&filters={"level":[0,1]}');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: [0, 1] });
        });

        it('should parse JSON filters with type', () => {
            const url = new URL('ws://localhost?channel=main&filters={"type":["error","warn"]}');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ type: ['error', 'warn'] });
        });

        it('should parse JSON filters with multiple properties', () => {
            const filters = {
                level: [0, 1],
                type: ['error', 'warn'],
                tags: ['api', 'database'],
                source: ['server']
            };
            const url = new URL(`ws://localhost?channel=main&filters=${encodeURIComponent(JSON.stringify(filters))}`);
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual(filters);
        });

        it('should handle invalid JSON gracefully', () => {
            const url = new URL('ws://localhost?channel=main&filters={invalid-json}');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toBeUndefined();
        });

        it('should prioritize JSON filters over individual parameters', () => {
            const url = new URL('ws://localhost?channel=main&filters={"level":[0]}&level=1,2');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: [0] });
        });
    });

    describe('individual level parameter', () => {
        it('should parse single numeric level', () => {
            const url = new URL('ws://localhost?channel=main&level=0');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: '0' });
        });

        it('should parse single string level', () => {
            const url = new URL('ws://localhost?channel=main&level=error');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: 'error' });
        });

        it('should parse comma-separated levels', () => {
            const url = new URL('ws://localhost?channel=main&level=0,1,2');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: ['0', '1', '2'] });
        });

        it('should parse comma-separated string levels', () => {
            const url = new URL('ws://localhost?channel=main&level=error,warn,info');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: ['error', 'warn', 'info'] });
        });

        it('should trim whitespace from levels', () => {
            const url = new URL('ws://localhost?channel=main&level=0 , 1 , 2');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: ['0', '1', '2'] });
        });

        it('should handle mixed numeric and string levels', () => {
            const url = new URL('ws://localhost?channel=main&level=0,error,1');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ level: ['0', 'error', '1'] });
        });
    });

    describe('individual type parameter', () => {
        it('should parse single type', () => {
            const url = new URL('ws://localhost?channel=main&type=error');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ type: 'error' });
        });

        it('should parse comma-separated types', () => {
            const url = new URL('ws://localhost?channel=main&type=error,warn,info');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ type: ['error', 'warn', 'info'] });
        });

        it('should trim whitespace from types', () => {
            const url = new URL('ws://localhost?channel=main&type=error , warn , info');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ type: ['error', 'warn', 'info'] });
        });

        it('should handle all valid log types', () => {
            const types = ['fatal', 'error', 'warn', 'log', 'info', 'success', 'fail', 'ready', 'start', 'debug', 'trace', 'verbose', 'silent'];
            const url = new URL(`ws://localhost?channel=main&type=${types.join(',')}`);
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ type: types });
        });
    });

    describe('individual tags parameter', () => {
        it('should parse single tag', () => {
            const url = new URL('ws://localhost?channel=main&tags=api');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ tags: ['api'] });
        });

        it('should parse comma-separated tags', () => {
            const url = new URL('ws://localhost?channel=main&tags=api,database,cache');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ tags: ['api', 'database', 'cache'] });
        });

        it('should trim whitespace from tags', () => {
            const url = new URL('ws://localhost?channel=main&tags=api , database , cache');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ tags: ['api', 'database', 'cache'] });
        });
    });

    describe('individual sources parameter', () => {
        it('should parse single source', () => {
            const url = new URL('ws://localhost?channel=main&sources=server');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ source: ['server'] });
        });

        it('should parse comma-separated sources', () => {
            const url = new URL('ws://localhost?channel=main&sources=server,client,worker');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ source: ['server', 'client', 'worker'] });
        });

        it('should trim whitespace from sources', () => {
            const url = new URL('ws://localhost?channel=main&sources=server , client , worker');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({ source: ['server', 'client', 'worker'] });
        });
    });

    describe('combined parameters', () => {
        it('should parse level and type together', () => {
            const url = new URL('ws://localhost?channel=main&level=0,1&type=error,warn');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                level: ['0', '1'],
                type: ['error', 'warn']
            });
        });

        it('should parse all filter parameters together', () => {
            const url = new URL('ws://localhost?channel=main&level=0,1&type=error,warn&tags=api,db&sources=server');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                level: ['0', '1'],
                type: ['error', 'warn'],
                tags: ['api', 'db'],
                source: ['server']
            });
        });

        it('should handle single values for all parameters', () => {
            const url = new URL('ws://localhost?channel=main&level=0&type=error&tags=api&sources=server');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                level: '0',
                type: 'error',
                tags: ['api'],
                source: ['server']
            });
        });

        it('should handle mix of single and multiple values', () => {
            const url = new URL('ws://localhost?channel=main&level=0&type=error,warn&tags=api&sources=server,client');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                level: '0',
                type: ['error', 'warn'],
                tags: ['api'],
                source: ['server', 'client']
            });
        });
    });

    describe('edge cases', () => {
        it('should handle URL without any parameters', () => {
            const url = new URL('ws://localhost');
            const result = parseUrlParams(url);

            expect(result.channel).toBeUndefined();
            expect(result.filters).toBeUndefined();
        });

        it('should handle empty parameter values', () => {
            const url = new URL('ws://localhost?channel=&level=&type=');
            const result = parseUrlParams(url);

            expect(result.channel).toBeUndefined();
            expect(result.filters).toBeUndefined();
        });

        it('should handle parameters with only commas', () => {
            const url = new URL('ws://localhost?channel=main&level=,,,&type=,');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                level: ['', '', '', ''],
                type: ['', '']
            });
        });

        it('should handle URL-encoded special characters', () => {
            const url = new URL('ws://localhost?channel=main&tags=api%2Fv1,test%20tag');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            expect(result.filters).toEqual({
                tags: ['api/v1', 'test tag']
            });
        });

        it('should handle duplicate parameters (first one wins)', () => {
            const url = new URL('ws://localhost?channel=main&level=0&level=1');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('main');
            // URLSearchParams.get() returns the first value when duplicates exist
            expect(result.filters).toEqual({ level: '0' });
        });
    });

    describe('real-world scenarios', () => {
        it('should parse typical error filtering scenario', () => {
            const url = new URL('ws://localhost?channel=production&level=0&type=error,fatal&tags=critical&sources=api-server');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('production');
            expect(result.filters).toEqual({
                level: '0',
                type: ['error', 'fatal'],
                tags: ['critical'],
                source: ['api-server']
            });
        });

        it('should parse debug scenario with multiple levels', () => {
            const url = new URL('ws://localhost?channel=dev&level=3,4,5&sources=client,server');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('dev');
            expect(result.filters).toEqual({
                level: ['3', '4', '5'],
                source: ['client', 'server']
            });
        });

        it('should parse monitoring scenario with tags', () => {
            const url = new URL('ws://localhost?channel=monitoring&type=warn,error&tags=performance,security,availability');
            const result = parseUrlParams(url);

            expect(result.channel).toBe('monitoring');
            expect(result.filters).toEqual({
                type: ['warn', 'error'],
                tags: ['performance', 'security', 'availability']
            });
        });

        it('should parse JSON filters for complex filtering', () => {
            const filters = {
                level: [0, 1, 2],
                type: ['error', 'warn', 'info'],
                tags: ['auth', 'api', 'database'],
                source: ['backend-service', 'worker-service']
            };
            const url = new URL(`ws://localhost?channel=staging&filters=${encodeURIComponent(JSON.stringify(filters))}`);
            const result = parseUrlParams(url);

            expect(result.channel).toBe('staging');
            expect(result.filters).toEqual(filters);
        });
    });
});
