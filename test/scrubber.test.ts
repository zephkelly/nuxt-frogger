import { describe, it, expect, beforeEach } from 'vitest';
import { LogScrubber } from './../src/runtime/scrubber';
import { SCRUB_STRATEGY, type ScrubRule } from './../src/runtime/scrubber/types';
import { defineScrub, fields } from './../src/runtime/scrubber/builder';
import { RECOMMENDED_RULES } from './../src/runtime/scrubber/recommended';
import { compileScrubRules } from './../src/runtime/scrubber/compile';
import type { LoggerObject } from './../src/runtime/shared/types/log';

function makeLog(ctx: Record<string, any>): LoggerObject {
    return {
        id: 'fixture-id',
        time: 1_700_000_000_000,
        lvl: 3,
        sev: 9,
        type: 'info',
        msg: 'test',
        ctx,
        env: 'server',
        trace: { traceId: '123', spanId: '456' },
    };
}

/** A scrubber loaded with the opt-in RECOMMENDED_RULES bundle (compiled, as at runtime). */
function recommendedScrubber(): LogScrubber {
    return new LogScrubber({ rules: compileScrubRules(RECOMMENDED_RULES) });
}

describe('LogScrubber', () => {
    describe('Opt-in by default (the core regression)', () => {
        it('scrubs nothing when enabled with no rules', () => {
            const scrubber = new LogScrubber();
            const log = makeLog({
                password: 'hunter2',
                email: 'jane@example.com',
                name: 'Frogger',
                token: 'abc123',
            });

            const result = scrubber.scrubLoggerObject(log);

            expect(result.scrubbed).toBe(false);
            expect(log.ctx).toEqual({
                password: 'hunter2',
                email: 'jane@example.com',
                name: 'Frogger',
                token: 'abc123',
            });
        });

        it('does not scrub the bare `name` key without an opt-in rule', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog({ name: 'Frogger' });

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.name).toBe('Frogger');
        });

        it('does not mangle a serialized error `error.name` (the F*****r bug)', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog({
                error: { name: 'FetchError', message: 'refresh failed', stack: 'at ...' },
            });

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.error.name).toBe('FetchError');
            expect(log.ctx.error.message).toBe('refresh failed');
        });
    });

    describe('Strategies', () => {
        function scrubWith(strategy: string, value: any): any {
            const scrubber = new LogScrubber({
                rules: [{ action: strategy as any, fieldPatterns: ['v'], priority: 100 }],
            });
            const log = makeLog({ v: value });
            scrubber.scrubLoggerObject(log);
            return log.ctx.v;
        }

        it('redact replaces strings, zeroes numbers, keeps booleans', () => {
            expect(scrubWith(SCRUB_STRATEGY.REDACT, 'secret123')).toBe('[REDACTED]');
            expect(scrubWith(SCRUB_STRATEGY.REDACT, 12345)).toBe(0);
            expect(scrubWith(SCRUB_STRATEGY.REDACT, true)).toBe(true);
            expect(scrubWith(SCRUB_STRATEGY.REDACT, false)).toBe(false);
        });

        it('redact leaves null/undefined/empty untouched', () => {
            expect(scrubWith(SCRUB_STRATEGY.REDACT, null)).toBe(null);
            expect(scrubWith(SCRUB_STRATEGY.REDACT, undefined)).toBe(undefined);
            expect(scrubWith(SCRUB_STRATEGY.REDACT, '')).toBe('');
            expect(scrubWith(SCRUB_STRATEGY.REDACT, '   ')).toBe('   ');
        });

        it('maskAll replaces every char, preserving length', () => {
            expect(scrubWith(SCRUB_STRATEGY.MASK_ALL, 'Hello')).toBe('*****');
        });

        it('keepFirst keeps the first char', () => {
            expect(scrubWith(SCRUB_STRATEGY.KEEP_FIRST, 'Hello')).toBe('H****');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_FIRST, 'A')).toBe('*');
        });

        it('keepLast keeps the last char', () => {
            expect(scrubWith(SCRUB_STRATEGY.KEEP_LAST, 'Hello')).toBe('****o');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_LAST, 'A')).toBe('*');
        });

        it('keepEnds keeps both ends and preserves length', () => {
            expect(scrubWith(SCRUB_STRATEGY.KEEP_ENDS, 'John')).toBe('J**n');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_ENDS, 'Jonathan')).toBe('J******n');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_ENDS, 'FetchError')).toBe('F********r');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_ENDS, 'Jo')).toBe('**');
            expect(scrubWith(SCRUB_STRATEGY.KEEP_ENDS, 'A')).toBe('*');
        });

        it('hash produces a stable hash', () => {
            const a = scrubWith(SCRUB_STRATEGY.HASH, '123-45-6789');
            const b = scrubWith(SCRUB_STRATEGY.HASH, '123-45-6789');
            expect(a).toMatch(/^\[HASH:[0-9a-f]+\]$/);
            expect(a).toBe(b);
        });

        it('maskEmail masks the local part', () => {
            expect(scrubWith(SCRUB_STRATEGY.MASK_EMAIL, 'user@example.com')).toBe('u***@example.com');
            expect(scrubWith(SCRUB_STRATEGY.MASK_EMAIL, 'a@example.com')).toBe('*@example.com');
            expect(scrubWith(SCRUB_STRATEGY.MASK_EMAIL, 'notanemail')).toBe('notanemail');
        });

        it('maskPhone keeps the first and last digit', () => {
            expect(scrubWith(SCRUB_STRATEGY.MASK_PHONE, '1234567890')).toBe('1********0');
            expect(scrubWith(SCRUB_STRATEGY.MASK_PHONE, '(123) 456-7890')).toBe('(1**) ***-***0');
            expect(scrubWith(SCRUB_STRATEGY.MASK_PHONE, '123')).toBe('123');
        });

        it('maskCard keeps the last 4 digits', () => {
            expect(scrubWith(SCRUB_STRATEGY.MASK_CARD, '4111 1111 1111 1111')).toBe('**** **** **** 1111');
            expect(scrubWith(SCRUB_STRATEGY.MASK_CARD, '1234')).toBe('1234');
            expect(scrubWith(SCRUB_STRATEGY.MASK_CARD, '12345')).toBe('*2345');
        });

        it('still resolves legacy SCRUB_ACTION tokens', () => {
            expect(scrubWith('redact_full', 'secret')).toBe('[REDACTED]');
            expect(scrubWith('mask_partial', 'John')).toBe('J**n');
            expect(scrubWith('mask_first', 'Hello')).toBe('H****');
            expect(scrubWith('hash_value', 'x')).toMatch(/^\[HASH:[0-9a-f]+\]$/);
        });
    });

    describe('Fluent builder', () => {
        it('compiles strategy methods into rules', () => {
            const opts = defineScrub()
                .redact('apiSecret')
                .maskEmail('email')
                .keepEnds('firstName')
                .build();

            expect(opts.rules).toHaveLength(3);
            expect(opts.rules![0]).toMatchObject({ action: SCRUB_STRATEGY.REDACT, fieldPatterns: ['apiSecret'] });
            expect(opts.rules![1]!.action).toBe(SCRUB_STRATEGY.MASK_EMAIL);
            expect(opts.rules![2]!.action).toBe(SCRUB_STRATEGY.KEEP_ENDS);
        });

        it('flattens field-list arrays passed to a method', () => {
            const opts = defineScrub().redact(fields.passwords, 'apiSecret').build();
            const patterns = opts.rules![0]!.fieldPatterns;
            expect(patterns).toContain('password');
            expect(patterns).toContain('apiSecret');
        });

        it('compiles RegExp field patterns to a serialisable form', () => {
            const opts = defineScrub().keepEnds(/customer.*name/i).build();
            const pattern = opts.rules![0]!.fieldPatterns[0] as any;
            expect(pattern).toEqual({ source: 'customer.*name', flags: 'i' });
            expect(JSON.stringify(opts)).toContain('customer.*name');
        });

        it('applies a built config end to end', () => {
            const opts = defineScrub().redact('apiSecret').keepEnds(fields.names).build();
            const scrubber = new LogScrubber(opts);
            const log = makeLog({ apiSecret: 'shh', firstName: 'Jonathan', name: 'Frogger' });

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.apiSecret).toBe('[REDACTED]');
            expect(log.ctx.firstName).toBe('J******n');
            expect(log.ctx.name).toBe('Frogger');
        });

        it('carries config setters through build', () => {
            const opts = defineScrub({ maxDepth: 3 }).deepScrub(false).build();
            expect(opts.maxDepth).toBe(3);
            expect(opts.deepScrub).toBe(false);
        });

        it('.use() spreads in RECOMMENDED_RULES', () => {
            const scrubber = new LogScrubber(defineScrub().use(...RECOMMENDED_RULES).build());
            expect(scrubber.wouldScrub('password').wouldScrub).toBe(true);
            expect(scrubber.wouldScrub('email').wouldScrub).toBe(true);
            expect(scrubber.wouldScrub('name').wouldScrub).toBe(false);
        });
    });

    describe('RECOMMENDED_RULES bundle', () => {
        let scrubber: LogScrubber;
        beforeEach(() => { scrubber = recommendedScrubber(); });

        it('redacts passwords and secrets', () => {
            const log = makeLog({ password: 'hunter2', accessToken: 'abc' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.password).toBe('[REDACTED]');
            expect(log.ctx.accessToken).toBe('[REDACTED]');
        });

        it('masks emails and phones', () => {
            const log = makeLog({ email: 'jane@example.com', phone: '1234567890' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.email).toBe('j***@example.com');
            expect(log.ctx.phone).toBe('1********0');
        });

        it('hashes government ids and masks card numbers', () => {
            const log = makeLog({ ssn: '123-45-6789', creditCard: '4111 1111 1111 1111' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.ssn).toMatch(/^\[HASH:[0-9a-f]+\]$/);
            expect(log.ctx.creditCard).toBe('**** **** **** 1111');
        });

        it('partially masks names but not the bare `name`', () => {
            const log = makeLog({ firstName: 'Jane', name: 'Frogger' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.firstName).toBe('J**e');
            expect(log.ctx.name).toBe('Frogger');
        });
    });

    describe('Serialized RegExp round-trip', () => {
        it('matches after RegExp is compiled to {source, flags}', () => {
            const rules = compileScrubRules([
                { action: SCRUB_STRATEGY.MASK_EMAIL, fieldPatterns: [/.*email.*/i], priority: 90 },
            ]);
            // Survives a JSON round-trip (as it would through runtime config).
            const serialized: ScrubRule[] = JSON.parse(JSON.stringify(rules));
            const scrubber = new LogScrubber({ rules: serialized });

            const log = makeLog({ myEmailAddress: 'user@example.com' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.myEmailAddress).toBe('u***@example.com');
        });
    });

    describe('Never mutates the caller input (copy-on-write)', () => {
        it('leaves the original ctx object untouched', () => {
            const scrubber = recommendedScrubber();
            const original = { email: 'jane@example.com', password: 'hunter2', name: 'Frogger' };
            const log = makeLog(original);

            scrubber.scrubLoggerObject(log);

            // The stored record is scrubbed...
            expect(log.ctx.email).toBe('j***@example.com');
            expect(log.ctx.password).toBe('[REDACTED]');
            // ...but the caller's object is preserved verbatim.
            expect(original).toEqual({ email: 'jane@example.com', password: 'hunter2', name: 'Frogger' });
            expect(log.ctx).not.toBe(original);
        });

        it('does not mutate nested objects shared with the caller', () => {
            const scrubber = recommendedScrubber();
            const sharedUser = { password: 'secret123', email: 'jane@example.com' };
            const original = { user: sharedUser, requestId: 'abc' };
            const log = makeLog(original);

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.user.password).toBe('[REDACTED]');
            expect(log.ctx.user.email).toBe('j***@example.com');
            // The caller's nested object is untouched and no longer shared.
            expect(sharedUser).toEqual({ password: 'secret123', email: 'jane@example.com' });
            expect(log.ctx.user).not.toBe(sharedUser);
        });

        it('does not mutate objects nested in arrays', () => {
            const scrubber = recommendedScrubber();
            const first = { password: 'a' };
            const log = makeLog({ users: [first, { password: 'b' }] });

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.users[0].password).toBe('[REDACTED]');
            expect(first.password).toBe('a');
        });

        it('shares (does not clone) subtrees with nothing to scrub', () => {
            const scrubber = recommendedScrubber();
            const meta = { region: 'us-east', retries: 3 };
            const log = makeLog({ password: 'secret123', meta });

            scrubber.scrubLoggerObject(log);

            expect(log.ctx.password).toBe('[REDACTED]');
            // Untouched subtree is shared by reference, not needlessly deep-copied.
            expect(log.ctx.meta).toBe(meta);
        });

        it('re-scrubbing the same source is stable across logs', () => {
            const scrubber = recommendedScrubber();
            const shared = { password: 'secret123' };

            scrubber.scrubLoggerObject(makeLog(shared));
            const secondLog = makeLog(shared);
            scrubber.scrubLoggerObject(secondLog);

            // Because the source is never mutated, the second log scrubs the real
            // value, not an already-redacted one.
            expect(secondLog.ctx.password).toBe('[REDACTED]');
            expect(shared.password).toBe('secret123');
        });
    });

    describe('Deep scrubbing', () => {
        it('scrubs nested objects when deepScrub is enabled', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog({ user: { credentials: { password: 'secret123' } } });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.user.credentials.password).toBe('[REDACTED]');
        });

        it('does not recurse when deepScrub is disabled', () => {
            const scrubber = new LogScrubber({
                rules: compileScrubRules(RECOMMENDED_RULES),
                deepScrub: false,
            });
            const log = makeLog({ user: { password: 'secret123' } });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.user.password).toBe('secret123');
        });

        it('scrubs arrays of objects', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog({ users: [{ password: 'a' }, { password: 'b' }] });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.users[0].password).toBe('[REDACTED]');
            expect(log.ctx.users[1].password).toBe('[REDACTED]');
        });

        it('respects maxDepth when set', () => {
            const scrubber = new LogScrubber({
                rules: compileScrubRules(RECOMMENDED_RULES),
                maxDepth: 2,
            });
            const log = makeLog({ l1: { l2: { l3: { password: 'secret123' } } } });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.l1.l2.l3.password).toBe('secret123');
        });

        it('has no depth limit by default (maxDepth undefined)', () => {
            const scrubber = recommendedScrubber();
            // 30 levels deep - beyond the old default of 10.
            let deep: any = { password: 'secret123' };
            for (let i = 0; i < 30; i++) deep = { nested: deep };
            const log = makeLog(deep);

            scrubber.scrubLoggerObject(log);

            let cursor: any = log.ctx;
            for (let i = 0; i < 30; i++) cursor = cursor.nested;
            expect(cursor.password).toBe('[REDACTED]');
        });

        it('handles circular references', () => {
            const scrubber = recommendedScrubber();
            const circular: any = { password: 'secret123' };
            circular.self = circular;
            const log = makeLog(circular);
            expect(() => scrubber.scrubLoggerObject(log)).not.toThrow();
            expect(log.ctx.password).toBe('[REDACTED]');
        });

        it('reports nested and array field paths', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog({
                user: { password: 'x', email: 'a@b.com' },
                users: [{ password: 'y' }],
            });
            const result = scrubber.scrubLoggerObject(log);
            expect(result.fieldsModified).toContain('user.password');
            expect(result.fieldsModified).toContain('user.email');
            expect(result.fieldsModified).toContain('users.[0].password');
        });
    });

    describe('findRule caching and matching', () => {
        let scrubber: LogScrubber;
        beforeEach(() => { scrubber = recommendedScrubber(); });

        it('is case-insensitive for exact matches', () => {
            expect(scrubber.wouldScrub('PASSWORD').wouldScrub).toBe(true);
            expect(scrubber.wouldScrub('Password').wouldScrub).toBe(true);
        });

        it('matches regex patterns', () => {
            expect(scrubber.wouldScrub('myEmailAddress').wouldScrub).toBe(true);
            expect(scrubber.wouldScrub('PHONENUMBER').wouldScrub).toBe(true);
        });

        it('caches null results and evicts past MAX_CACHE_SIZE', () => {
            for (let i = 0; i < 1001; i++) scrubber.wouldScrub(`field${i}`);
            expect(scrubber.wouldScrub('field0').wouldScrub).toBe(false);
        });
    });

    describe('Priority across pattern kinds', () => {
        const exactLow: ScrubRule = {
            action: SCRUB_STRATEGY.REDACT,
            fieldPatterns: ['token'],
            priority: 1,
            description: 'exact-low',
        };
        const regexHigh: ScrubRule = {
            action: SCRUB_STRATEGY.HASH,
            fieldPatterns: [/tok/i],
            priority: 10,
            description: 'regex-high',
        };
        const regexLow: ScrubRule = {
            action: SCRUB_STRATEGY.HASH,
            fieldPatterns: [/tok/i],
            priority: 0,
            description: 'regex-low',
        };
        const exactHigh: ScrubRule = {
            action: SCRUB_STRATEGY.REDACT,
            fieldPatterns: ['token'],
            priority: 10,
            description: 'exact-high',
        };

        it('a higher-priority regex rule beats a lower-priority exact rule', () => {
            const scrubber = new LogScrubber({ rules: [exactLow, regexHigh] });
            expect(scrubber.wouldScrub('token').rule?.description).toBe('regex-high');
        });

        it('a higher-priority exact rule beats a lower-priority regex rule', () => {
            const scrubber = new LogScrubber({ rules: [exactHigh, regexLow] });
            expect(scrubber.wouldScrub('token').rule?.description).toBe('exact-high');
        });

        it('an exact rule wins a priority tie', () => {
            const tiedRegex: ScrubRule = { ...regexHigh, priority: 1, description: 'regex-tied' };
            const scrubber = new LogScrubber({ rules: [exactLow, tiedRegex] });
            expect(scrubber.wouldScrub('token').rule?.description).toBe('exact-low');
        });

        it('a field only a regex matches still resolves to the regex rule', () => {
            const scrubber = new LogScrubber({ rules: [exactLow, regexLow] });
            expect(scrubber.wouldScrub('accessToken').rule?.description).toBe('regex-low');
        });
    });

    describe('Config and rule management', () => {
        it('does not scrub when disabled', () => {
            const scrubber = new LogScrubber({ enabled: false, rules: compileScrubRules(RECOMMENDED_RULES) });
            const log = makeLog({ password: 'secret123' });
            const result = scrubber.scrubLoggerObject(log);
            expect(result.scrubbed).toBe(false);
            expect(log.ctx.password).toBe('secret123');
        });

        it('adds and removes rules, invalidating the cache', () => {
            const scrubber = new LogScrubber();
            expect(scrubber.wouldScrub('customSecret').wouldScrub).toBe(false);

            scrubber.addRule({ action: SCRUB_STRATEGY.REDACT, fieldPatterns: ['customSecret'], priority: 100, description: 'x' });
            expect(scrubber.wouldScrub('customSecret').wouldScrub).toBe(true);

            scrubber.removeRule('x');
            expect(scrubber.wouldScrub('customSecret').wouldScrub).toBe(false);
        });

        it('respects rule priority for a shared field', () => {
            const scrubber = new LogScrubber({
                rules: [
                    { action: SCRUB_STRATEGY.REDACT, fieldPatterns: ['password'], priority: 100 },
                    { action: SCRUB_STRATEGY.HASH, fieldPatterns: ['password'], priority: 200 },
                ],
            });
            const log = makeLog({ password: 'secret123' });
            scrubber.scrubLoggerObject(log);
            expect(log.ctx.password).toMatch(/^\[HASH:[0-9a-f]+\]$/);
        });
    });

    describe('Statistics', () => {
        it('tracks processed/scrubbed counts and rate', () => {
            const scrubber = recommendedScrubber();
            scrubber.scrubLoggerObject(makeLog({ password: 'secret123' }));
            scrubber.scrubLoggerObject(makeLog({ normalField: 'value' }));
            const stats = scrubber.getStats();
            expect(stats.totalProcessed).toBe(2);
            expect(stats.totalScrubbed).toBe(1);
            expect(stats.scrubRate).toBe(0.5);
        });

        it('resets statistics', () => {
            const scrubber = recommendedScrubber();
            scrubber.scrubLoggerObject(makeLog({ password: 'secret123' }));
            scrubber.resetStats();
            const stats = scrubber.getStats();
            expect(stats.totalProcessed).toBe(0);
            expect(stats.totalScrubbed).toBe(0);
        });
    });

    describe('Edge cases', () => {
        it('handles null context', () => {
            const scrubber = recommendedScrubber();
            const log = makeLog(null as any);
            const result = scrubber.scrubLoggerObject(log);
            expect(result.scrubbed).toBe(false);
        });

        it('handles an empty batch', () => {
            const scrubber = recommendedScrubber();
            expect(scrubber.scrubBatch([])).toHaveLength(0);
        });
    });
});
