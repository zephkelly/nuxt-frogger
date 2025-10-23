import { describe, it, expect } from 'vitest';
import { LogLevelParser } from '../src/runtime/shared/utils/log-level-parser';
import type { LogLevelInput, ParsedLogLevel } from '../src/runtime/shared/utils/log-level-parser';

describe('LogLevelParser', () => {
    describe('parse - Numeric Input', () => {
        it('should parse level 0 (fatal, error)', () => {
            const result = LogLevelParser.parse(0);
            expect(result).toEqual({
                lvl: 0,
                types: ['fatal', 'error']
            });
        });

        it('should parse level 1 (warn)', () => {
            const result = LogLevelParser.parse(1);
            expect(result).toEqual({
                lvl: 1,
                types: ['warn']
            });
        });

        it('should parse level 2 (log)', () => {
            const result = LogLevelParser.parse(2);
            expect(result).toEqual({
                lvl: 2,
                types: ['log']
            });
        });

        it('should parse level 3 (info, success, fail, ready, start)', () => {
            const result = LogLevelParser.parse(3);
            expect(result).toEqual({
                lvl: 3,
                types: ['info', 'success', 'fail', 'ready', 'start']
            });
        });

        it('should parse level 4 (debug)', () => {
            const result = LogLevelParser.parse(4);
            expect(result).toEqual({
                lvl: 4,
                types: ['debug']
            });
        });

        it('should parse level 5 (trace)', () => {
            const result = LogLevelParser.parse(5);
            expect(result).toEqual({
                lvl: 5,
                types: ['trace']
            });
        });

        it('should parse level 999 (verbose)', () => {
            const result = LogLevelParser.parse(999);
            expect(result).toEqual({
                lvl: 999,
                types: ['verbose']
            });
        });

        it('should parse level -999 (silent)', () => {
            const result = LogLevelParser.parse(-999);
            expect(result).toEqual({
                lvl: -999,
                types: ['silent']
            });
        });

        it('should throw error for invalid numeric level', () => {
            expect(() => LogLevelParser.parse(99)).toThrow('Invalid log level: 99');
        });

        it('should throw error for negative invalid level', () => {
            expect(() => LogLevelParser.parse(-1)).toThrow('Invalid log level: -1');
        });
    });

    describe('parse - String Numeric Input', () => {
        it('should parse string "0" as level 0', () => {
            const result = LogLevelParser.parse('0');
            expect(result).toEqual({
                lvl: 0,
                types: ['fatal', 'error']
            });
        });

        it('should parse string "1" as level 1', () => {
            const result = LogLevelParser.parse('1');
            expect(result).toEqual({
                lvl: 1,
                types: ['warn']
            });
        });

        it('should parse string "2" as level 2', () => {
            const result = LogLevelParser.parse('2');
            expect(result).toEqual({
                lvl: 2,
                types: ['log']
            });
        });

        it('should parse string "3" as level 3', () => {
            const result = LogLevelParser.parse('3');
            expect(result).toEqual({
                lvl: 3,
                types: ['info', 'success', 'fail', 'ready', 'start']
            });
        });

        it('should parse string "4" as level 4', () => {
            const result = LogLevelParser.parse('4');
            expect(result).toEqual({
                lvl: 4,
                types: ['debug']
            });
        });

        it('should parse string "5" as level 5', () => {
            const result = LogLevelParser.parse('5');
            expect(result).toEqual({
                lvl: 5,
                types: ['trace']
            });
        });

        it('should parse string "999" as level 999', () => {
            const result = LogLevelParser.parse('999');
            expect(result).toEqual({
                lvl: 999,
                types: ['verbose']
            });
        });

        it('should parse string "-999" as level -999', () => {
            const result = LogLevelParser.parse('-999');
            expect(result).toEqual({
                lvl: -999,
                types: ['silent']
            });
        });

        it('should throw error for invalid string numeric level', () => {
            expect(() => LogLevelParser.parse('100')).toThrow('Invalid log level: 100');
        });
    });

    describe('parse - Log Type Name Input', () => {
        it('should parse "fatal" as level 0 with single type', () => {
            const result = LogLevelParser.parse('fatal');
            expect(result).toEqual({
                lvl: 0,
                types: ['fatal']
            });
        });

        it('should parse "error" as level 0 with single type', () => {
            const result = LogLevelParser.parse('error');
            expect(result).toEqual({
                lvl: 0,
                types: ['error']
            });
        });

        it('should parse "warn" as level 1', () => {
            const result = LogLevelParser.parse('warn');
            expect(result).toEqual({
                lvl: 1,
                types: ['warn']
            });
        });

        it('should parse "log" as level 2', () => {
            const result = LogLevelParser.parse('log');
            expect(result).toEqual({
                lvl: 2,
                types: ['log']
            });
        });

        it('should parse "info" as level 3', () => {
            const result = LogLevelParser.parse('info');
            expect(result).toEqual({
                lvl: 3,
                types: ['info']
            });
        });

        it('should parse "success" as level 3', () => {
            const result = LogLevelParser.parse('success');
            expect(result).toEqual({
                lvl: 3,
                types: ['success']
            });
        });

        it('should parse "fail" as level 3', () => {
            const result = LogLevelParser.parse('fail');
            expect(result).toEqual({
                lvl: 3,
                types: ['fail']
            });
        });

        it('should parse "ready" as level 3', () => {
            const result = LogLevelParser.parse('ready');
            expect(result).toEqual({
                lvl: 3,
                types: ['ready']
            });
        });

        it('should parse "start" as level 3', () => {
            const result = LogLevelParser.parse('start');
            expect(result).toEqual({
                lvl: 3,
                types: ['start']
            });
        });

        it('should parse "debug" as level 4', () => {
            const result = LogLevelParser.parse('debug');
            expect(result).toEqual({
                lvl: 4,
                types: ['debug']
            });
        });

        it('should parse "trace" as level 5', () => {
            const result = LogLevelParser.parse('trace');
            expect(result).toEqual({
                lvl: 5,
                types: ['trace']
            });
        });

        it('should parse "verbose" as level 999', () => {
            const result = LogLevelParser.parse('verbose');
            expect(result).toEqual({
                lvl: 999,
                types: ['verbose']
            });
        });

        it('should parse "silent" as level -999', () => {
            const result = LogLevelParser.parse('silent');
            expect(result).toEqual({
                lvl: -999,
                types: ['silent']
            });
        });

        it('should be case-insensitive for type names', () => {
            const result1 = LogLevelParser.parse('ERROR');
            const result2 = LogLevelParser.parse('Error');
            const result3 = LogLevelParser.parse('error');

            expect(result1).toEqual({ lvl: 0, types: ['error'] });
            expect(result2).toEqual({ lvl: 0, types: ['error'] });
            expect(result3).toEqual({ lvl: 0, types: ['error'] });
        });

        it('should throw error for invalid log type name', () => {
            expect(() => LogLevelParser.parse('invalid')).toThrow(
                /Invalid log type: 'invalid'/
            );
        });

        it('should throw error for empty string', () => {
            expect(() => LogLevelParser.parse('')).toThrow(
                /Invalid log type: ''/
            );
        });
    });

    describe('parseMultiple', () => {
        it('should parse multiple inputs', () => {
            const results = LogLevelParser.parseMultiple([0, 'warn', 'error']);
            expect(results).toEqual([
                { lvl: 0, types: ['fatal', 'error'] },
                { lvl: 1, types: ['warn'] },
                { lvl: 0, types: ['error'] }
            ]);
        });

        it('should handle empty array', () => {
            const results = LogLevelParser.parseMultiple([]);
            expect(results).toEqual([]);
        });

        it('should handle mixed input types', () => {
            const results = LogLevelParser.parseMultiple([0, '1', 'info', 'debug']);
            expect(results).toEqual([
                { lvl: 0, types: ['fatal', 'error'] },
                { lvl: 1, types: ['warn'] },
                { lvl: 3, types: ['info'] },
                { lvl: 4, types: ['debug'] }
            ]);
        });

        it('should throw error if any input is invalid', () => {
            expect(() => LogLevelParser.parseMultiple([0, 'invalid', 'warn'])).toThrow();
        });
    });

    describe('isValidLogType', () => {
        it('should return true for valid log type names', () => {
            expect(LogLevelParser.isValidLogType('fatal')).toBe(true);
            expect(LogLevelParser.isValidLogType('error')).toBe(true);
            expect(LogLevelParser.isValidLogType('warn')).toBe(true);
            expect(LogLevelParser.isValidLogType('log')).toBe(true);
            expect(LogLevelParser.isValidLogType('info')).toBe(true);
            expect(LogLevelParser.isValidLogType('success')).toBe(true);
            expect(LogLevelParser.isValidLogType('fail')).toBe(true);
            expect(LogLevelParser.isValidLogType('ready')).toBe(true);
            expect(LogLevelParser.isValidLogType('start')).toBe(true);
            expect(LogLevelParser.isValidLogType('debug')).toBe(true);
            expect(LogLevelParser.isValidLogType('trace')).toBe(true);
            expect(LogLevelParser.isValidLogType('verbose')).toBe(true);
            expect(LogLevelParser.isValidLogType('silent')).toBe(true);
        });

        it('should be case-insensitive', () => {
            expect(LogLevelParser.isValidLogType('ERROR')).toBe(true);
            expect(LogLevelParser.isValidLogType('Error')).toBe(true);
            expect(LogLevelParser.isValidLogType('WaRn')).toBe(true);
        });

        it('should return false for invalid log type names', () => {
            expect(LogLevelParser.isValidLogType('invalid')).toBe(false);
            expect(LogLevelParser.isValidLogType('notAType')).toBe(false);
            expect(LogLevelParser.isValidLogType('')).toBe(false);
            expect(LogLevelParser.isValidLogType('123')).toBe(false);
        });
    });

    describe('isValidLevel', () => {
        it('should return true for valid numeric levels', () => {
            expect(LogLevelParser.isValidLevel(0)).toBe(true);
            expect(LogLevelParser.isValidLevel(1)).toBe(true);
            expect(LogLevelParser.isValidLevel(2)).toBe(true);
            expect(LogLevelParser.isValidLevel(3)).toBe(true);
            expect(LogLevelParser.isValidLevel(4)).toBe(true);
            expect(LogLevelParser.isValidLevel(5)).toBe(true);
            expect(LogLevelParser.isValidLevel(999)).toBe(true);
            expect(LogLevelParser.isValidLevel(-999)).toBe(true);
        });

        it('should return false for invalid numeric levels', () => {
            expect(LogLevelParser.isValidLevel(6)).toBe(false);
            expect(LogLevelParser.isValidLevel(10)).toBe(false);
            expect(LogLevelParser.isValidLevel(-1)).toBe(false);
            expect(LogLevelParser.isValidLevel(100)).toBe(false);
        });
    });

    describe('getTypesForLevel', () => {
        it('should return all types for level 0', () => {
            const types = LogLevelParser.getTypesForLevel(0);
            expect(types).toEqual(['fatal', 'error']);
        });

        it('should return all types for level 3', () => {
            const types = LogLevelParser.getTypesForLevel(3);
            expect(types).toEqual(['info', 'success', 'fail', 'ready', 'start']);
        });

        it('should return single type for level 1', () => {
            const types = LogLevelParser.getTypesForLevel(1);
            expect(types).toEqual(['warn']);
        });

        it('should return empty array for invalid level', () => {
            const types = LogLevelParser.getTypesForLevel(99);
            expect(types).toEqual([]);
        });

        it('should return a copy of the types array', () => {
            const types1 = LogLevelParser.getTypesForLevel(0);
            const types2 = LogLevelParser.getTypesForLevel(0);
            expect(types1).not.toBe(types2); // Different array instances
            expect(types1).toEqual(types2); // Same content
        });
    });

    describe('getLevelForType', () => {
        it('should return correct level for each type', () => {
            expect(LogLevelParser.getLevelForType('fatal')).toBe(0);
            expect(LogLevelParser.getLevelForType('error')).toBe(0);
            expect(LogLevelParser.getLevelForType('warn')).toBe(1);
            expect(LogLevelParser.getLevelForType('log')).toBe(2);
            expect(LogLevelParser.getLevelForType('info')).toBe(3);
            expect(LogLevelParser.getLevelForType('success')).toBe(3);
            expect(LogLevelParser.getLevelForType('fail')).toBe(3);
            expect(LogLevelParser.getLevelForType('ready')).toBe(3);
            expect(LogLevelParser.getLevelForType('start')).toBe(3);
            expect(LogLevelParser.getLevelForType('debug')).toBe(4);
            expect(LogLevelParser.getLevelForType('trace')).toBe(5);
            expect(LogLevelParser.getLevelForType('verbose')).toBe(999);
            expect(LogLevelParser.getLevelForType('silent')).toBe(-999);
        });

        it('should be case-insensitive', () => {
            expect(LogLevelParser.getLevelForType('ERROR')).toBe(0);
            expect(LogLevelParser.getLevelForType('Error')).toBe(0);
            expect(LogLevelParser.getLevelForType('WARN')).toBe(1);
        });

        it('should return undefined for invalid type', () => {
            expect(LogLevelParser.getLevelForType('invalid')).toBeUndefined();
            expect(LogLevelParser.getLevelForType('')).toBeUndefined();
            expect(LogLevelParser.getLevelForType('notAType')).toBeUndefined();
        });
    });

    describe('normalizeForMatching', () => {
        it('should return all types for numeric level input', () => {
            const types = LogLevelParser.normalizeForMatching(0);
            expect(types).toEqual(['fatal', 'error']);
        });

        it('should return single type for specific type name input', () => {
            const types = LogLevelParser.normalizeForMatching('error');
            expect(types).toEqual(['error']);
        });

        it('should handle string numeric input', () => {
            const types = LogLevelParser.normalizeForMatching('3');
            expect(types).toEqual(['info', 'success', 'fail', 'ready', 'start']);
        });

        it('should throw error for invalid input', () => {
            expect(() => LogLevelParser.normalizeForMatching('invalid')).toThrow();
        });
    });

    describe('matchesFilter', () => {
        it('should match when log type is in numeric level filter', () => {
            expect(LogLevelParser.matchesFilter('error', 0, 0)).toBe(true);
            expect(LogLevelParser.matchesFilter('fatal', 0, 0)).toBe(true);
        });

        it('should not match when log level differs from numeric filter', () => {
            expect(LogLevelParser.matchesFilter('warn', 1, 0)).toBe(false);
            expect(LogLevelParser.matchesFilter('info', 3, 0)).toBe(false);
        });

        it('should match specific type name filter', () => {
            expect(LogLevelParser.matchesFilter('error', 0, 'error')).toBe(true);
        });

        it('should not match different type name in same level', () => {
            expect(LogLevelParser.matchesFilter('fatal', 0, 'error')).toBe(false);
        });

        it('should match when using string numeric filter', () => {
            expect(LogLevelParser.matchesFilter('error', 0, '0')).toBe(true);
        });

        it('should handle case-insensitive type names', () => {
            expect(LogLevelParser.matchesFilter('error', 0, 'ERROR')).toBe(true);
            expect(LogLevelParser.matchesFilter('error', 0, 'Error')).toBe(true);
        });

        it('should return false for invalid filter', () => {
            expect(LogLevelParser.matchesFilter('error', 0, 'invalid')).toBe(false);
        });

        it('should match any type at level 3 when using numeric filter', () => {
            expect(LogLevelParser.matchesFilter('info', 3, 3)).toBe(true);
            expect(LogLevelParser.matchesFilter('success', 3, 3)).toBe(true);
            expect(LogLevelParser.matchesFilter('fail', 3, 3)).toBe(true);
            expect(LogLevelParser.matchesFilter('ready', 3, 3)).toBe(true);
            expect(LogLevelParser.matchesFilter('start', 3, 3)).toBe(true);
        });

        it('should only match specific type when using type name filter', () => {
            expect(LogLevelParser.matchesFilter('info', 3, 'info')).toBe(true);
            expect(LogLevelParser.matchesFilter('success', 3, 'info')).toBe(false);
        });
    });

    describe('describe', () => {
        it('should describe numeric level input with all types', () => {
            const desc = LogLevelParser.describe(0);
            expect(desc).toBe('Level 0 (fatal, error)');
        });

        it('should describe level 3 with all types', () => {
            const desc = LogLevelParser.describe(3);
            expect(desc).toBe('Level 3 (info, success, fail, ready, start)');
        });

        it('should describe specific type name input', () => {
            const desc = LogLevelParser.describe('error');
            expect(desc).toBe("Type 'error' (level 0)");
        });

        it('should describe another specific type', () => {
            const desc = LogLevelParser.describe('info');
            expect(desc).toBe("Type 'info' (level 3)");
        });

        it('should describe string numeric input', () => {
            const desc = LogLevelParser.describe('1');
            expect(desc).toBe('Level 1 (warn)');
        });

        it('should handle invalid input gracefully', () => {
            const desc = LogLevelParser.describe('invalid');
            expect(desc).toBe('Invalid filter: invalid');
        });

        it('should handle invalid numeric level', () => {
            const desc = LogLevelParser.describe(99);
            expect(desc).toBe('Invalid filter: 99');
        });
    });

    describe('Edge Cases', () => {
        it('should handle whitespace in type names', () => {
            expect(() => LogLevelParser.parse(' error ')).toThrow();
        });

        it('should distinguish between "0" and 0', () => {
            const result1 = LogLevelParser.parse(0);
            const result2 = LogLevelParser.parse('0');
            expect(result1).toEqual(result2);
        });

        it('should handle numeric strings with leading zeros', () => {
            const result = LogLevelParser.parse('00');
            expect(result).toEqual({
                lvl: 0,
                types: ['fatal', 'error']
            });
        });

        it('should parse decimal numbers in strings as integers (parseInt behavior)', () => {
            const result = LogLevelParser.parse('1.5');
            expect(result).toEqual({
                lvl: 1,
                types: ['warn']
            });
        });

        it('should handle NaN string by throwing error', () => {
            expect(() => LogLevelParser.parse('NaN')).toThrow();
        });
    });

    describe('Real-world Use Cases', () => {
        it('should handle the user scenario: 0, "0", "fatal", "error" all mean level 0', () => {
            const input1 = LogLevelParser.parse(0);
            const input2 = LogLevelParser.parse('0');
            const input3 = LogLevelParser.parse('fatal');
            const input4 = LogLevelParser.parse('error');

            // All should be level 0
            expect(input1.lvl).toBe(0);
            expect(input2.lvl).toBe(0);
            expect(input3.lvl).toBe(0);
            expect(input4.lvl).toBe(0);

            // Numeric inputs return all types at that level
            expect(input1.types).toEqual(['fatal', 'error']);
            expect(input2.types).toEqual(['fatal', 'error']);

            // Specific type names return only that type
            expect(input3.types).toEqual(['fatal']);
            expect(input4.types).toEqual(['error']);
        });

        it('should filter logs correctly based on level 0 and 1', () => {
            // User wants to see level 0 and 1 logs
            const level0Types = LogLevelParser.normalizeForMatching(0);
            const level1Types = LogLevelParser.normalizeForMatching(1);
            const allAllowedTypes = [...level0Types, ...level1Types];

            // Simulate logs
            const errorLog = { type: 'error', lvl: 0 };
            const fatalLog = { type: 'fatal', lvl: 0 };
            const warnLog = { type: 'warn', lvl: 1 };
            const infoLog = { type: 'info', lvl: 3 };

            expect(allAllowedTypes.includes(errorLog.type)).toBe(true);
            expect(allAllowedTypes.includes(fatalLog.type)).toBe(true);
            expect(allAllowedTypes.includes(warnLog.type)).toBe(true);
            expect(allAllowedTypes.includes(infoLog.type)).toBe(false);
        });

        it('should match log from user example', () => {
            // The log from the user's example
            const log = {
                lvl: 0,
                type: 'error'
            };

            // User wants logs with level 0 or 1
            const matchesLevel0 = LogLevelParser.matchesFilter(log.type, log.lvl, 0);
            const matchesLevel1 = LogLevelParser.matchesFilter(log.type, log.lvl, 1);

            expect(matchesLevel0).toBe(true);
            expect(matchesLevel1).toBe(false);
        });

        it('should work with multiple filters as array', () => {
            const filters: LogLevelInput[] = [0, 1];
            const parsed = LogLevelParser.parseMultiple(filters);

            const log = { type: 'error', lvl: 0 };

            const matches = parsed.some(filter =>
                LogLevelParser.matchesFilter(log.type, log.lvl, filter.lvl)
            );

            expect(matches).toBe(true);
        });
    });

    describe('Type Safety', () => {
        it('should return ParsedLogLevel type', () => {
            const result: ParsedLogLevel = LogLevelParser.parse(0);
            expect(result).toHaveProperty('lvl');
            expect(result).toHaveProperty('types');
            expect(typeof result.lvl).toBe('number');
            expect(Array.isArray(result.types)).toBe(true);
        });

        it('should handle LogLevelInput union type', () => {
            const inputs: LogLevelInput[] = [0, '1', 'error'];
            inputs.forEach(input => {
                const result = LogLevelParser.parse(input);
                expect(result).toHaveProperty('lvl');
                expect(result).toHaveProperty('types');
            });
        });
    });
});
