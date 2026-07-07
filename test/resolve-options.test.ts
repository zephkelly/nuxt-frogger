import { describe, it, expect } from 'vitest';

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

        it('keeps file + console core on (batch + file resolved)', () => {
            expect(r.batch).toEqual(DEFAULT_BATCH);
            expect(r.file).toEqual(DEFAULT_FILE);
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
            expect(DEFAULT_SCRUB.maxDepth).toBe(10);
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
            if (a.scrub) (a.scrub as any).maxDepth = 1;

            const b = resolveFroggerOptions({ preset: 'full' });
            expect(b.rateLimit && b.rateLimit.limits?.perIp).toBe(DEFAULT_RATE_LIMIT.limits?.perIp);
            expect(b.scrub && (b.scrub as any).maxDepth).toBe(10);
            // and the const itself is intact
            expect(DEFAULT_RATE_LIMIT.limits?.perIp).toBe(100);
            expect(DEFAULT_SCRUB.maxDepth).toBe(10);
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

    describe('public + passthrough', () => {
        it('custom endpoint + baseUrl pass through', () => {
            const r = resolveFroggerOptions({ public: { endpoint: '/logs', baseUrl: 'https://x.dev' } });
            expect(r.public.endpoint).toBe('/logs');
            expect(r.public.baseUrl).toBe('https://x.dev');
        });

        it('public.batch:false disables the client batch', () => {
            expect(resolveFroggerOptions({ public: { batch: false } }).public.batch).toBe(false);
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
});
