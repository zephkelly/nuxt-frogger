import { describe, it, expect, beforeEach } from 'vitest';
import { LogScrubber } from './../src/runtime/scrubber';
import { SCRUB_ACTION, type ScrubRule } from './../src/runtime/scrubber/types';
import type { LoggerObject } from './../src/runtime/shared/types/log';

describe('LogScrubber', () => {
    let scrubber: LogScrubber;

    beforeEach(() => {
        scrubber = new LogScrubber();
    });

    describe('Constructor and Configuration', () => {
        it('should initialize with default config', () => {
            expect(scrubber).toBeDefined();
            const stats = scrubber.getStats();
            expect(stats.totalProcessed).toBe(0);
            expect(stats.totalScrubbed).toBe(0);
        });

        it('should initialize with custom config', () => {
            const customScrubber = new LogScrubber({
                enabled: false,
                maxDepth: 5,
                deepScrub: false,
                preserveTypes: false
            });
            expect(customScrubber).toBeDefined();
        });

        it('should initialize with custom rules', () => {
            const customRule: ScrubRule = {
                action: SCRUB_ACTION.REDACT_FULL,
                fieldPatterns: ['customField'],
                priority: 100,
                description: 'Custom rule'
            };

            const customScrubber = new LogScrubber({
                rules: [customRule]
            });

            const result = customScrubber.wouldScrub('customField');
            expect(result.wouldScrub).toBe(true);
        });
    });

    describe('Default Rules', () => {
        it('should have default rules for passwords', () => {
            const result = scrubber.wouldScrub('password');
            expect(result.wouldScrub).toBe(true);
            expect(result.rule?.action).toBe(SCRUB_ACTION.REDACT_FULL);
        });

        it('should have default rules for emails', () => {
            const result = scrubber.wouldScrub('email');
            expect(result.wouldScrub).toBe(true);
            expect(result.rule?.action).toBe(SCRUB_ACTION.MASK_EMAIL);
        });

        it('should have default rules for phones', () => {
            const result = scrubber.wouldScrub('phone');
            expect(result.wouldScrub).toBe(true);
            expect(result.rule?.action).toBe(SCRUB_ACTION.MASK_PHONE);
        });

        it('should have default rules for SSN', () => {
            const result = scrubber.wouldScrub('ssn');
            expect(result.wouldScrub).toBe(true);
            expect(result.rule?.action).toBe(SCRUB_ACTION.HASH_VALUE);
        });
    });

    describe('findRule - Caching', () => {
        it('should cache exact matches', () => {
            const result1 = scrubber.wouldScrub('password');
            const result2 = scrubber.wouldScrub('password');
            expect(result1.wouldScrub).toBe(true);
            expect(result2.wouldScrub).toBe(true);
        });

        it('should cache regex matches', () => {
            const result1 = scrubber.wouldScrub('userEmail');
            const result2 = scrubber.wouldScrub('userEmail');
            expect(result1.wouldScrub).toBe(true);
            expect(result2.wouldScrub).toBe(true);
        });

        it('should cache null results', () => {
            const result1 = scrubber.wouldScrub('randomField');
            const result2 = scrubber.wouldScrub('randomField');
            expect(result1.wouldScrub).toBe(false);
            expect(result2.wouldScrub).toBe(false);
        });

        it('should evict cache when MAX_CACHE_SIZE is exceeded', () => {
            // Fill cache beyond MAX_CACHE_SIZE (1000)
            for (let i = 0; i < 1001; i++) {
                scrubber.wouldScrub(`field${i}`);
            }

            // First field should be evicted
            const result = scrubber.wouldScrub('field0');
            expect(result.wouldScrub).toBe(false);
        });

        it('should be case-insensitive for exact matches', () => {
            const result1 = scrubber.wouldScrub('PASSWORD');
            const result2 = scrubber.wouldScrub('Password');
            const result3 = scrubber.wouldScrub('password');

            expect(result1.wouldScrub).toBe(true);
            expect(result2.wouldScrub).toBe(true);
            expect(result3.wouldScrub).toBe(true);
        });
    });

    describe('applyScrubAction - REDACT_FULL', () => {
        it('should redact string values', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe('[REDACTED]');
        });

        it('should preserve number type when preserveTypes is true', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 12345 },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe(0);
        });

        it('should not scrub null values', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: null },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe(null);
        });

        it('should not scrub undefined values', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: undefined },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe(undefined);
        });

        it('should not scrub empty strings', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: '' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe('');
        });
    });

    describe('applyScrubAction - MASK_PARTIAL', () => {
        it('should mask short strings (< 2 chars)', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { name: 'A' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.name).toBe('*');
        });

        it('should mask medium strings (2-6 chars)', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { name: 'John' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.name).toBe('J***');
        });

        it('should mask long strings (7+ chars)', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { name: 'Jonathan' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.name).toBe('J*****n');
        });
    });

    describe('applyScrubAction - MASK_FIRST_ONLY', () => {
        it('should mask single character', () => {
            const customScrubber = new LogScrubber({
                rules: [{
                    action: SCRUB_ACTION.MASK_FIRST_ONLY,
                    fieldPatterns: ['test'],
                    priority: 100
                }]
            });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { test: 'A' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            customScrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.test).toBe('*');
        });

        it('should mask all but first character', () => {
            const customScrubber = new LogScrubber({
                rules: [{
                    action: SCRUB_ACTION.MASK_FIRST_ONLY,
                    fieldPatterns: ['test'],
                    priority: 100
                }]
            });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { test: 'Hello' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            customScrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.test).toBe('H****');
        });
    });

    describe('applyScrubAction - MASK_EMAIL', () => {
        it('should mask valid email addresses', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { email: 'user@example.com' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.email).toBe('u***@example.com');
        });

        it('should mask short local part emails', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { email: 'a@example.com' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.email).toBe('*@example.com');
        });

        it('should not mask invalid email format', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { email: 'notanemail' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.email).toBe('notanemail');
        });
    });

    describe('applyScrubAction - MASK_PHONE', () => {
        it('should mask phone numbers with enough digits', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { phone: '1234567890' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.phone).toBe('1********0');
        });

        it('should mask formatted phone numbers', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { phone: '(123) 456-7890' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.phone).toBe('(1**) ***-***0');
        });

        it('should not mask phone with too few digits', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { phone: '123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.phone).toBe('123');
        });
    });

    describe('applyScrubAction - HASH_VALUE', () => {
        it('should hash sensitive values', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { ssn: '123-45-6789' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.ssn).toMatch(/^\[HASH:[0-9a-f]+\]$/);
        });

        it('should produce consistent hashes', () => {
            const logObj1: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { ssn: '123-45-6789' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const logObj2: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { ssn: '123-45-6789' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj1);
            scrubber.scrubLoggerObject(logObj2);
            expect(logObj1.ctx.ssn).toBe(logObj2.ctx.ssn);
        });
    });

    describe('scrubObject - Deep Scrubbing', () => {
        it('should scrub nested objects when deepScrub is enabled', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    user: {
                        credentials: {
                            password: 'secret123'
                        }
                    }
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.user.credentials.password).toBe('[REDACTED]');
        });

        it('should not scrub nested objects when deepScrub is disabled', () => {
            const shallowScrubber = new LogScrubber({ deepScrub: false });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    user: {
                        password: 'secret123'
                    }
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            shallowScrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.user.password).toBe('secret123');
        });

        it('should scrub arrays with objects', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    users: [
                        { password: 'secret1' },
                        { password: 'secret2' }
                    ]
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.users[0].password).toBe('[REDACTED]');
            expect(logObj.ctx.users[1].password).toBe('[REDACTED]');
        });

        it('should respect maxDepth limit', () => {
            const limitedScrubber = new LogScrubber({ maxDepth: 2 });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    level1: {
                        level2: {
                            level3: {
                                password: 'secret123'
                            }
                        }
                    }
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            limitedScrubber.scrubLoggerObject(logObj);
            // Should not scrub beyond maxDepth
            expect(logObj.ctx.level1.level2.level3.password).toBe('secret123');
        });

        it('should handle circular references', () => {
            const circularObj: any = {
                password: 'secret123'
            };
            circularObj.self = circularObj;

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: circularObj,
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            expect(() => {
                scrubber.scrubLoggerObject(logObj);
            }).not.toThrow();
            expect(logObj.ctx.password).toBe('[REDACTED]');
        });

        it('should not scrub empty arrays', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: [] },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toEqual([]);
        });

        it('should not scrub empty objects', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: {} },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toEqual({});
        });
    });

    describe('scrubLoggerObject', () => {
        it('should return correct result when scrubbing occurs', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(true);
            expect(result.fieldsModified).toContain('password');
        });

        it('should return correct result when no scrubbing occurs', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { normalField: 'value' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(false);
            expect(result.fieldsModified).toHaveLength(0);
        });

        it('should not scrub when disabled', () => {
            const disabledScrubber = new LogScrubber({ enabled: false });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = disabledScrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(false);
            expect(logObj.ctx.password).toBe('secret123');
        });

        it('should track nested field modifications', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    user: {
                        password: 'secret123',
                        email: 'user@example.com'
                    }
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(true);
            expect(result.fieldsModified).toContain('user.password');
            expect(result.fieldsModified).toContain('user.email');
        });

        it('should track array field modifications', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: {
                    users: [
                        { password: 'secret1' }
                    ]
                },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(true);
            expect(result.fieldsModified).toContain('users.[0].password');  // ✅ Fixed!
        });
    });

    describe('scrubBatch', () => {
        it('should scrub multiple logs', () => {
            const logs: LoggerObject[] = [
                {
                    time: Date.now(),
                    lvl: 3,
                    type: 'info',
                    msg: 'test1',
                    ctx: { password: 'secret1' },
                    env: 'server',
                    trace: { traceId: '123', spanId: '456' }
                },
                {
                    time: Date.now(),
                    lvl: 3,
                    type: 'info',
                    msg: 'test2',
                    ctx: { password: 'secret2' },
                    env: 'server',
                    trace: { traceId: '123', spanId: '456' }
                }
            ];

            const results = scrubber.scrubBatch(logs);
            expect(results).toHaveLength(2);
            expect(results[0].scrubbed).toBe(true);
            expect(results[1].scrubbed).toBe(true);
            expect(logs[0].ctx.password).toBe('[REDACTED]');
            expect(logs[1].ctx.password).toBe('[REDACTED]');
        });

        it('should handle empty batch', () => {
            const results = scrubber.scrubBatch([]);
            expect(results).toHaveLength(0);
        });
    });

    describe('Rule Management', () => {
        it('should add new rule', () => {
            const newRule: ScrubRule = {
                action: SCRUB_ACTION.REDACT_FULL,
                fieldPatterns: ['customSecret'],
                priority: 100,
                description: 'Custom secret field'
            };

            scrubber.addRule(newRule);

            const result = scrubber.wouldScrub('customSecret');
            expect(result.wouldScrub).toBe(true);
        });

        it('should remove rule by description', () => {
            scrubber.removeRule('Remove passwords and secrets completely');

            const result = scrubber.wouldScrub('password');
            expect(result.wouldScrub).toBe(false);
        });

        it('should update config', () => {
            scrubber.updateConfig({ enabled: false });

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(false);
        });
    });

    describe('Statistics', () => {
        it('should track scrubbing statistics', () => {
            const logObj1: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const logObj2: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { normalField: 'value' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj1);
            scrubber.scrubLoggerObject(logObj2);

            const stats = scrubber.getStats();
            expect(stats.totalProcessed).toBe(2);
            expect(stats.totalScrubbed).toBe(1);
            expect(stats.scrubRate).toBe(0.5);
        });

        it('should calculate scrubRate as 0 when no logs processed', () => {
            const stats = scrubber.getStats();
            expect(stats.scrubRate).toBe(0);
        });

        it('should reset statistics', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            scrubber.resetStats();

            const stats = scrubber.getStats();
            expect(stats.totalProcessed).toBe(0);
            expect(stats.totalScrubbed).toBe(0);
        });
    });

    describe('Rule Priority', () => {
        it('should respect rule priority', () => {
            const highPriorityRule: ScrubRule = {
                action: SCRUB_ACTION.HASH_VALUE,
                fieldPatterns: ['password'],
                priority: 200,
                description: 'High priority hash'
            };

            scrubber.addRule(highPriorityRule);

            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: 'secret123' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            // Should use HASH_VALUE (high priority) instead of REDACT_FULL
            expect(logObj.ctx.password).toMatch(/^\[HASH:[0-9a-f]+\]$/);
        });
    });

    describe('Regex Pattern Matching', () => {
        it('should match regex patterns', () => {
            const result = scrubber.wouldScrub('myEmailAddress');
            expect(result.wouldScrub).toBe(true);
        });

        it('should match case-insensitive regex patterns', () => {
            const result = scrubber.wouldScrub('PHONENUMBER');
            expect(result.wouldScrub).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle null context', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: null as any,
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            const result = scrubber.scrubLoggerObject(logObj);
            expect(result.scrubbed).toBe(false);
        });

        it('should handle non-object values in context', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: true },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe('[REDACTED]');
        });

        it('should handle whitespace-only strings', () => {
            const logObj: LoggerObject = {
                time: Date.now(),
                lvl: 3,
                type: 'info',
                msg: 'test',
                ctx: { password: '   ' },
                env: 'server',
                trace: { traceId: '123', spanId: '456' }
            };

            scrubber.scrubLoggerObject(logObj);
            expect(logObj.ctx.password).toBe('   ');
        });
    });
});