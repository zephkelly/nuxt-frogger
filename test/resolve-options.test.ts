import { describe, it, expect, vi } from 'vitest';

import {
    resolveFroggerOptions,
    FROGGER_PRESETS,
    DEFAULT_PRESET,
    DEFAULT_SCRUB,
    DEFAULT_RATE_LIMIT,
    DEFAULT_WEBSOCKET,
    DEFAULT_ERROR_CAPTURE_CLIENT,
    DEFAULT_ERROR_CAPTURE_SERVER,
    DEFAULT_BATCH,
    DEFAULT_FILE,
} from '../src/runtime/shared/utils/resolve-options';

import { froggerInternal } from '../src/runtime/shared/utils/internal-log';
import type {
    ResolvedHttpTransport,
    ResolvedFileTransport,
} from '../src/runtime/shared/types/transports';

import { DEFAULT_LOGGING_ENDPOINT } from '../src/runtime/shared/types/module-options';

describe('resolveFroggerOptions', () => {
    describe('bare install (no options)', () => {
        const r = resolveFroggerOptions();

        it('defaults to the minimal preset', () => {
            expect(r.preset).toBe('minimal');
            expect(DEFAULT_PRESET).toBe('minimal');
        });

        it('enables client + server modules', () => {
            expect(r.clientModule).toBe(true);
            expect(r.serverModule).toEqual({ autoEventCapture: true });
        });

        it('keeps batching on but configures no persistent transport (console only)', () => {
            expect(r.batch).toEqual(DEFAULT_BATCH);
            expect(r.transports).toEqual({ server: [], client: [] });
        });

        it('turns every heavy subsystem OFF', () => {
            expect(r.scrub).toBe(false);
            expect(r.rateLimit).toBe(false);
            expect(r.websocket).toBe(false);
            expect(r.errorCapture).toEqual({ client: false, server: false });
        });

        it('resolves the default ingest endpoint', () => {
            expect(r.public.endpoint).toBe(DEFAULT_LOGGING_ENDPOINT);
        });

        it('defaults app name', () => {
            expect(r.app).toBe('nuxt-frogger');
        });
    });

    describe('presets', () => {
        it('minimal turns everything off', () => {
            const r = resolveFroggerOptions({ preset: 'minimal' });
            expect(r.scrub).toBe(false);
            expect(r.rateLimit).toBe(false);
            expect(r.websocket).toBe(false);
            expect(r.errorCapture).toEqual({ client: false, server: false });
        });

        it('standard enables scrub, rate-limit and error capture but not websocket', () => {
            const r = resolveFroggerOptions({ preset: 'standard' });
            expect(r.scrub).toEqual(DEFAULT_SCRUB);
            expect(r.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
            expect(r.websocket).toBe(false);
            expect(r.errorCapture).toEqual({
                client: DEFAULT_ERROR_CAPTURE_CLIENT,
                server: DEFAULT_ERROR_CAPTURE_SERVER,
            });
        });

        it('full enables everything including websocket', () => {
            const r = resolveFroggerOptions({ preset: 'full' });
            expect(r.scrub).toEqual(DEFAULT_SCRUB);
            expect(r.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
            expect(r.websocket).toEqual(DEFAULT_WEBSOCKET);
            expect(r.errorCapture).toEqual({
                client: DEFAULT_ERROR_CAPTURE_CLIENT,
                server: DEFAULT_ERROR_CAPTURE_SERVER,
            });
        });

        it('falls back to minimal for an unknown preset', () => {
            // @ts-expect-error — intentionally invalid
            const r = resolveFroggerOptions({ preset: 'bogus' });
            expect(r.preset).toBe('minimal');
            expect(r.scrub).toBe(false);
        });

        it('preset table matches expected toggles', () => {
            expect(FROGGER_PRESETS.minimal).toEqual({ scrub: false, rateLimit: false, websocket: false, errorCapture: false });
            expect(FROGGER_PRESETS.standard).toEqual({ scrub: true, rateLimit: true, websocket: false, errorCapture: true });
            expect(FROGGER_PRESETS.full).toEqual({ scrub: true, rateLimit: true, websocket: true, errorCapture: true });
        });
    });

    describe('explicit options override the preset', () => {
        it('full preset + scrub:false disables scrub', () => {
            const r = resolveFroggerOptions({ preset: 'full', scrub: false });
            expect(r.scrub).toBe(false);
            // others stay on
            expect(r.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
        });

        it('minimal preset + scrub:true enables scrub with defaults', () => {
            const r = resolveFroggerOptions({ preset: 'minimal', scrub: true });
            expect(r.scrub).toEqual(DEFAULT_SCRUB);
        });

        it('minimal preset + rateLimit:true enables rate limiting', () => {
            const r = resolveFroggerOptions({ preset: 'minimal', rateLimit: true });
            expect(r.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
        });

        it('full preset + websocket:false disables websocket', () => {
            const r = resolveFroggerOptions({ preset: 'full', websocket: false });
            expect(r.websocket).toBe(false);
        });
    });

    describe('object overrides merge onto defaults', () => {
        it('scrub object merges with defaults', () => {
            const r = resolveFroggerOptions({ scrub: { maxDepth: 3 } });
            expect(r.scrub).toEqual({ maxDepth: 3, deepScrub: true, preserveTypes: true });
        });

        it('websocket object merges and keeps the default route', () => {
            const r = resolveFroggerOptions({ websocket: { defaultChannel: 'custom' } as any });
            expect(r.websocket).toMatchObject({
                route: DEFAULT_WEBSOCKET.route,
                defaultChannel: 'custom',
            });
        });

        it('rateLimit object deep-merges nested tiers', () => {
            const r = resolveFroggerOptions({ rateLimit: { limits: { perIp: 5 } } as any });
            expect(r.rateLimit).not.toBe(false);
            if (r.rateLimit) {
                expect(r.rateLimit.limits?.perIp).toBe(5);
                // untouched tiers keep defaults
                expect(r.rateLimit.limits?.global).toBe(DEFAULT_RATE_LIMIT.limits?.global);
            }
        });

        it('a user array REPLACES the default array (does not concat)', () => {
            const r = resolveFroggerOptions({ rateLimit: { blocking: { timeouts: [5] } } as any });
            expect(r.rateLimit).not.toBe(false);
            if (r.rateLimit) {
                expect(r.rateLimit.blocking?.timeouts).toEqual([5]);
                // sibling blocking fields keep defaults
                expect(r.rateLimit.blocking?.enabled).toBe(DEFAULT_RATE_LIMIT.blocking?.enabled);
            }
        });

        it('does not mutate the shared default objects', () => {
            resolveFroggerOptions({ scrub: { maxDepth: 1 } });
            // DEFAULT_SCRUB deliberately has no maxDepth (undefined = unlimited)
            expect(DEFAULT_SCRUB.maxDepth).toBeUndefined();
        });
    });

    describe('immutability — resolved config never aliases the shared defaults', () => {
        it('enabled subsystems are fresh clones, not the DEFAULT_* references', () => {
            const r = resolveFroggerOptions({ preset: 'full' });
            expect(r.scrub).not.toBe(DEFAULT_SCRUB);
            expect(r.rateLimit).not.toBe(DEFAULT_RATE_LIMIT);
            expect(r.websocket).not.toBe(DEFAULT_WEBSOCKET);
            expect(r.errorCapture.client).not.toBe(DEFAULT_ERROR_CAPTURE_CLIENT);
            expect(r.errorCapture.server).not.toBe(DEFAULT_ERROR_CAPTURE_SERVER);
            // ...but value-equal
            expect(r.scrub).toEqual(DEFAULT_SCRUB);
            expect(r.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
        });

        it('nested branches are cloned too (not shared with DEFAULT_RATE_LIMIT)', () => {
            const r = resolveFroggerOptions({ preset: 'standard' });
            if (r.rateLimit) {
                expect(r.rateLimit.limits).not.toBe(DEFAULT_RATE_LIMIT.limits);
                expect(r.rateLimit.windows).not.toBe(DEFAULT_RATE_LIMIT.windows);
                expect(r.rateLimit.blocking).not.toBe(DEFAULT_RATE_LIMIT.blocking);
            }
        });

        it('mutating one resolved config does not poison the next resolve', () => {
            const a = resolveFroggerOptions({ preset: 'full' });
            if (a.rateLimit) a.rateLimit.limits!.perIp = 999;
            if (a.scrub) (a.scrub as any).deepScrub = false;

            const b = resolveFroggerOptions({ preset: 'full' });
            expect(b.rateLimit && b.rateLimit.limits?.perIp).toBe(DEFAULT_RATE_LIMIT.limits?.perIp);
            expect(b.scrub && (b.scrub as any).deepScrub).toBe(true);
            // and the const itself is intact
            expect(DEFAULT_RATE_LIMIT.limits?.perIp).toBe(100);
            expect(DEFAULT_SCRUB.deepScrub).toBe(true);
        });
    });

    describe('errorCapture normalization', () => {
        it('true enables both sides', () => {
            const r = resolveFroggerOptions({ errorCapture: true });
            expect(r.errorCapture).toEqual({
                client: DEFAULT_ERROR_CAPTURE_CLIENT,
                server: DEFAULT_ERROR_CAPTURE_SERVER,
            });
        });

        it('false disables both sides', () => {
            const r = resolveFroggerOptions({ preset: 'full', errorCapture: false });
            expect(r.errorCapture).toEqual({ client: false, server: false });
        });

        it('per-side booleans enable one side only', () => {
            const r = resolveFroggerOptions({ errorCapture: { client: true, server: false } });
            expect(r.errorCapture.client).toEqual(DEFAULT_ERROR_CAPTURE_CLIENT);
            expect(r.errorCapture.server).toBe(false);
        });

        it('a client object leaves the unspecified server side off', () => {
            const r = resolveFroggerOptions({ errorCapture: { client: { includeStack: false } } });
            expect(r.errorCapture.client).toMatchObject({ includeStack: false, includeComponent: true });
            expect(r.errorCapture.server).toBe(false);
        });
    });

    describe('consoleOutput normalization', () => {
        it('defaults to on for both runtimes', () => {
            expect(resolveFroggerOptions().consoleOutput).toEqual({ client: true, server: true });
        });

        it('false silences both runtimes', () => {
            expect(resolveFroggerOptions({ consoleOutput: false }).consoleOutput)
                .toEqual({ client: false, server: false });
        });

        it('true enables both runtimes', () => {
            expect(resolveFroggerOptions({ consoleOutput: true }).consoleOutput)
                .toEqual({ client: true, server: true });
        });

        it('per-side booleans silence one runtime only', () => {
            expect(resolveFroggerOptions({ consoleOutput: { client: false } }).consoleOutput)
                .toEqual({ client: false, server: true });

            expect(resolveFroggerOptions({ consoleOutput: { server: false } }).consoleOutput)
                .toEqual({ client: true, server: false });
        });

        it('is independent of the preset', () => {
            for (const preset of ['minimal', 'standard', 'full'] as const) {
                expect(resolveFroggerOptions({ preset }).consoleOutput)
                    .toEqual({ client: true, server: true });
            }
        });

        it('never aliases the shared default', () => {
            const r = resolveFroggerOptions();
            r.consoleOutput.client = false;
            expect(resolveFroggerOptions().consoleOutput.client).toBe(true);
        });
    });

    describe('core toggles', () => {
        it('batch:false disables batching', () => {
            expect(resolveFroggerOptions({ batch: false }).batch).toBe(false);
        });

        it('batch object merges with defaults', () => {
            const r = resolveFroggerOptions({ batch: { maxSize: 5 } });
            expect(r.batch).toMatchObject({ maxSize: 5, maxAge: DEFAULT_BATCH.maxAge });
        });

        it('serverModule:false is preserved', () => {
            expect(resolveFroggerOptions({ serverModule: false }).serverModule).toBe(false);
        });

        it('serverModule object passes through', () => {
            expect(resolveFroggerOptions({ serverModule: { autoEventCapture: false } }).serverModule)
                .toEqual({ autoEventCapture: false });
        });

        it('clientModule:false is preserved', () => {
            expect(resolveFroggerOptions({ clientModule: false }).clientModule).toBe(false);
        });
    });

    describe('transports', () => {
        // Server list is a ResolvedServerTransport union; every entry in these
        // http/observe cases resolves to an http transport.
        const http = (r: ReturnType<typeof resolveFroggerOptions>, i = 0) =>
            r.transports.server[i] as ResolvedHttpTransport;

        it('defaults to empty client + server lists', () => {
            const r = resolveFroggerOptions();
            expect(r.transports).toEqual({ server: [], client: [] });
        });

        it('a bare { url } entry defaults to server-only (server:true, client:false)', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://observe.example.com/api/observe/ingest' }],
            });
            expect(r.transports.server).toHaveLength(1);
            expect(r.transports.client).toHaveLength(0);
        });

        it('an untagged object resolves to an http transport (backward compat)', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest' }],
            });
            expect(http(r).type).toBe('http');
            expect(http(r).apiKeyLocation).toBe('header');
        });

        it('splits url into origin baseUrl + path endpoint', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://observe.example.com/api/observe/ingest?tenant=1' }],
            });
            expect(http(r).baseUrl).toBe('https://observe.example.com');
            expect(http(r).endpoint).toBe('/api/observe/ingest?tenant=1');
        });

        it('url wins over split baseUrl/endpoint when both are given', () => {
            const r = resolveFroggerOptions({
                transports: [{
                    url: 'https://a.example.com/ingest',
                    baseUrl: 'https://b.example.com',
                    endpoint: '/other',
                }],
            });
            expect(http(r).baseUrl).toBe('https://a.example.com');
            expect(http(r).endpoint).toBe('/ingest');
        });

        it('client:true puts the entry in BOTH lists', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest', client: true }],
            });
            expect(r.transports.server).toHaveLength(1);
            expect(r.transports.client).toHaveLength(1);
        });

        it('client:true + server:false is client-only', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest', client: true, server: false }],
            });
            expect(r.transports.server).toHaveLength(0);
            expect(r.transports.client).toHaveLength(1);
        });

        it('carries apiKeyLocation:query through', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest', apiKey: 'k', apiKeyLocation: 'query' }],
            });
            expect(http(r).apiKeyLocation).toBe('query');
        });

        it('keeps apiKey discrete and never folds it into headers', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest', apiKey: 'secret', headers: { 'x-custom': '1' } }],
            });
            expect(http(r).apiKey).toBe('secret');
            expect(http(r).headers).toEqual({ 'x-custom': '1' });
            expect(http(r).headers).not.toHaveProperty('x-api-key');
        });

        it('names the transport by resolved url when no name is given', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest' }],
            });
            expect(http(r).name).toBe('https://x.dev/ingest');
        });

        it('respects an explicit name', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'https://x.dev/ingest', name: 'observe' }],
            });
            expect(http(r).name).toBe('observe');
        });

        it('accepts the split baseUrl/endpoint form without url', () => {
            const r = resolveFroggerOptions({
                transports: [{ baseUrl: 'https://x.dev', endpoint: '/ingest' }],
            });
            expect(http(r).baseUrl).toBe('https://x.dev');
            expect(http(r).endpoint).toBe('/ingest');
        });

        it('drops an entry with no url/baseUrl/endpoint', () => {
            const r = resolveFroggerOptions({
                transports: [{ apiKey: 'k' } as any, { url: 'https://ok.dev/ingest' }],
            });
            expect(r.transports.server).toHaveLength(1);
            expect(http(r).baseUrl).toBe('https://ok.dev');
        });

        it('drops an entry with an invalid url', () => {
            const r = resolveFroggerOptions({
                transports: [{ url: 'not a url' }, { url: 'https://ok.dev/ingest' }],
            });
            expect(r.transports.server).toHaveLength(1);
            expect(http(r).baseUrl).toBe('https://ok.dev');
        });

        it('carries through HttpTransport tuning fields', () => {
            const r = resolveFroggerOptions({
                transports: [{
                    url: 'https://x.dev/ingest',
                    vendor: 'v', timeout: 5000, retryOnFailure: false, maxRetries: 1, retryDelay: 250,
                }],
            });
            expect(http(r)).toMatchObject({
                vendor: 'v', timeout: 5000, retryOnFailure: false, maxRetries: 1, retryDelay: 250,
            });
        });

        it('is independent of the preset (works under minimal)', () => {
            const r = resolveFroggerOptions({
                preset: 'minimal',
                transports: [{ url: 'https://x.dev/ingest', client: true }],
            });
            expect(r.transports.server).toHaveLength(1);
            expect(r.transports.client).toHaveLength(1);
        });

        describe('file transport', () => {
            it('tags the entry type:file and is server-only', () => {
                const r = resolveFroggerOptions({ transports: [{ type: 'file' }] });
                expect(r.transports.server).toHaveLength(1);
                expect(r.transports.client).toHaveLength(0);
                expect(r.transports.server[0]!.type).toBe('file');
            });

            it('fills options from DEFAULT_FILE', () => {
                const r = resolveFroggerOptions({ transports: [{ type: 'file' }] });
                const t = r.transports.server[0] as ResolvedFileTransport;
                expect(t.options).toEqual(DEFAULT_FILE);
            });

            it('merges partial file options onto the defaults', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'file', directory: 'var/log' }],
                });
                const t = r.transports.server[0] as ResolvedFileTransport;
                expect(t.options.directory).toBe('var/log');
                expect(t.options.maxSize).toBe(DEFAULT_FILE.maxSize);
            });

            it('carries an explicit name, defaulting to "file"', () => {
                expect((resolveFroggerOptions({ transports: [{ type: 'file' }] })
                    .transports.server[0] as ResolvedFileTransport).name).toBe('file');
                expect((resolveFroggerOptions({ transports: [{ type: 'file', name: 'disk' }] })
                    .transports.server[0] as ResolvedFileTransport).name).toBe('disk');
            });
        });

        describe('observe transport', () => {
            it('defaults to server-only with header auth on the ingest path', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'https://observe.app.com', key: 'k' }],
                });
                expect(r.transports.server).toHaveLength(1);
                expect(r.transports.client).toHaveLength(0);
                expect(http(r)).toMatchObject({
                    type: 'http',
                    baseUrl: 'https://observe.app.com',
                    endpoint: '/api/observe/ingest/frogger',
                    apiKey: 'k',
                    apiKeyLocation: 'header',
                    maxBatchEvents: 500,
                });
                expect(http(r).maxBodyBytes).toBe(950 * 1024);
            });

            it('parses the url down to its origin (drops any path)', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'https://observe.app.com/some/path', key: 'k' }],
                });
                expect(http(r).baseUrl).toBe('https://observe.app.com');
                expect(http(r).endpoint).toBe('/api/observe/ingest/frogger');
            });

            it('client:true opts in a query-auth browser entry with publicKeyOk', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'https://observe.app.com', key: 'k', client: true }],
                });
                expect(r.transports.server).toHaveLength(1);
                expect(r.transports.client).toHaveLength(1);
                const c = r.transports.client[0]!;
                expect(c.apiKeyLocation).toBe('query');
                expect(c.apiKey).toBe('k');
                expect(c.publicKeyOk).toBe(true);
            });

            it('server:false + client:true is browser-only', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'https://observe.app.com', key: 'k', server: false, client: true }],
                });
                expect(r.transports.server).toHaveLength(0);
                expect(r.transports.client).toHaveLength(1);
            });

            it('never embeds the key in the transport name', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'https://observe.app.com', key: 'super-secret' }],
                });
                expect(http(r).name).toBe('observe (https://observe.app.com)');
                expect(http(r).name).not.toContain('super-secret');
            });

            it('skips an observe entry with an invalid url', () => {
                const r = resolveFroggerOptions({
                    transports: [{ type: 'observe', url: 'not a url', key: 'k' }],
                });
                expect(r.transports.server).toHaveLength(0);
                expect(r.transports.client).toHaveLength(0);
            });
        });
    });

    describe('public + passthrough', () => {
        it('custom endpoint + baseUrl pass through', () => {
            const r = resolveFroggerOptions({ public: { endpoint: '/logs', baseUrl: 'https://x.dev' } });
            expect(r.public.endpoint).toBe('/logs');
            expect(r.public.baseUrl).toBe('https://x.dev');
        });

        it('public.batch:false disables the client batch', () => {
            expect(resolveFroggerOptions({ public: { batch: false } }).public.batch).toBe(false);
        });

        it('public.endpoint:false disables the client POST to the app endpoint', () => {
            expect(resolveFroggerOptions({ public: { endpoint: false } }).public.endpoint).toBe(false);
        });

        it('verbose / logLevel pass through', () => {
            const r = resolveFroggerOptions({ verbose: true, logLevel: 'debug' });
            expect(r.verbose).toBe(true);
            expect(r.logLevel).toBe('debug');
        });

        it('app object passes through', () => {
            const r = resolveFroggerOptions({ app: { name: 'x', version: '2' } });
            expect(r.app).toEqual({ name: 'x', version: '2' });
        });
    });

    describe('deprecations', () => {
        it('warns when the removed top-level `file` option is present', () => {
            const warn = vi.spyOn(froggerInternal, 'warn').mockImplementation(() => {});
            resolveFroggerOptions({ file: { directory: 'logs' } } as any);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('The top-level `file` option was removed'),
            );
            warn.mockRestore();
        });

        it('does not warn when `file` is absent', () => {
            const warn = vi.spyOn(froggerInternal, 'warn').mockImplementation(() => {});
            resolveFroggerOptions({ transports: [{ type: 'file' }] });
            expect(warn).not.toHaveBeenCalledWith(
                expect.stringContaining('The top-level `file` option was removed'),
            );
            warn.mockRestore();
        });
    });
});
