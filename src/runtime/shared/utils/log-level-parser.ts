import { LOG_LEVELS, LEVEL_TO_NUMBER } from "../types/log";
import type { LogType } from "consola";

/**
 * Represents a parsed log level with its numeric level and associated log types
 */
export interface ParsedLogLevel {
    lvl: number;
    types: LogType[];
}

/**
 * Union type for all possible log level inputs
 */
export type LogLevelInput = number | string | LogType;

/**
 * Utility class for parsing and normalizing log level specifications
 * 
 * Supports multiple input formats:
 * - Numeric levels: 0, 1, 2, etc.
 * - String numeric levels: '0', '1', '2', etc.
 * - Log type names: 'error', 'fatal', 'warn', 'info', etc.
 * 
 * @example
 * ```ts
 * // All of these return level 0 with types ['fatal', 'error']
 * LogLevelParser.parse(0)
 * LogLevelParser.parse('0')
 * LogLevelParser.parse('fatal')
 * LogLevelParser.parse('error')
 * 
 * // Specific type only
 * LogLevelParser.parse('error') // { lvl: 0, types: ['error'] }
 * ```
 */
export class LogLevelParser {
    /**
     * Parse a single log level input and return the normalized format
     * 
     * @param input - The log level to parse (number, string number, or log type name)
     * @returns Parsed log level with numeric level and associated types
     * @throws Error if the input is invalid or unrecognized
     */
    static parse(input: LogLevelInput): ParsedLogLevel {
        // Handle numeric input (e.g., 0, 1, 2)
        if (typeof input === 'number') {
            return this.parseNumericLevel(input);
        }

        // Handle string input (could be '0', 'error', 'warn', etc.)
        if (typeof input === 'string') {
            // Try parsing as numeric string first
            const numericValue = parseInt(input, 10);
            if (!isNaN(numericValue)) {
                return this.parseNumericLevel(numericValue);
            }

            // Parse as log type name
            return this.parseLogTypeName(input);
        }

        throw new Error(`Invalid log level input: ${input}`);
    }

    /**
     * Parse multiple log level inputs and return all associated levels and types
     * 
     * @param inputs - Array of log level inputs
     * @returns Combined parsed log levels with unique types
     */
    static parseMultiple(inputs: LogLevelInput[]): ParsedLogLevel[] {
        return inputs.map(input => this.parse(input));
    }

    /**
     * Parse a numeric log level and return all associated log types
     * 
     * @param level - Numeric log level (e.g., 0, 1, 2)
     * @returns Parsed log level with all types at that level
     */
    private static parseNumericLevel(level: number): ParsedLogLevel {
        const types = LOG_LEVELS[level as keyof typeof LOG_LEVELS];

        if (!types) {
            throw new Error(`Invalid log level: ${level}. Valid levels are: ${Object.keys(LOG_LEVELS).join(', ')}`);
        }

        return {
            lvl: level,
            types: [...types] as LogType[]
        };
    }

    /**
     * Parse a log type name and return its numeric level and the specific type
     * 
     * @param typeName - Log type name (e.g., 'error', 'warn', 'info')
     * @returns Parsed log level with specific type
     */
    private static parseLogTypeName(typeName: string): ParsedLogLevel {
        const normalizedTypeName = typeName.toLowerCase();
        const level = LEVEL_TO_NUMBER[normalizedTypeName];

        if (level === undefined) {
            throw new Error(
                `Invalid log type: '${typeName}'. Valid types are: ${Object.keys(LEVEL_TO_NUMBER).join(', ')}`
            );
        }

        return {
            lvl: level,
            types: [normalizedTypeName as LogType]
        };
    }

    /**
     * Check if a log type string is valid
     * 
     * @param typeName - Log type name to validate
     * @returns True if the type name is valid
     */
    static isValidLogType(typeName: string): boolean {
        return LEVEL_TO_NUMBER[typeName.toLowerCase()] !== undefined;
    }

    /**
     * Check if a numeric level is valid
     * 
     * @param level - Numeric level to validate
     * @returns True if the level is valid
     */
    static isValidLevel(level: number): boolean {
        return LOG_LEVELS[level as keyof typeof LOG_LEVELS] !== undefined;
    }

    /**
     * Get all log types for a given numeric level
     * 
     * @param level - Numeric log level
     * @returns Array of log types at that level
     */
    static getTypesForLevel(level: number): LogType[] {
        const types = LOG_LEVELS[level as keyof typeof LOG_LEVELS];
        return types ? [...types] as LogType[] : [];
    }

    /**
     * Get the numeric level for a given log type
     * 
     * @param typeName - Log type name
     * @returns Numeric level or undefined if invalid
     */
    static getLevelForType(typeName: string): number | undefined {
        return LEVEL_TO_NUMBER[typeName.toLowerCase()];
    }

    /**
     * Normalize a log level input to a consistent format for comparison
     * Returns an array of log types that should match
     * 
     * @param input - The log level input to normalize
     * @returns Array of log type strings for matching
     */
    static normalizeForMatching(input: LogLevelInput): string[] {
        const parsed = this.parse(input);
        return parsed.types;
    }

    /**
     * Check if a log object matches the given level filter
     * 
     * @param logType - The log type from the log object
     * @param logLevel - The numeric level from the log object
     * @param filter - The filter to check against
     * @returns True if the log matches the filter
     */
    static matchesFilter(logType: string, logLevel: number, filter: LogLevelInput): boolean {
        try {
            const parsed = this.parse(filter);

            // If the parsed filter is for a specific type (not all types at that level)
            // then check for exact type match
            const allTypesAtLevel = this.getTypesForLevel(parsed.lvl);
            const isSpecificTypeFilter = parsed.types.length < allTypesAtLevel.length;

            if (isSpecificTypeFilter) {
                return parsed.types.includes(logType as LogType);
            }

            // Otherwise, check if log level matches
            return logLevel === parsed.lvl;
        } catch {
            return false;
        }
    }

    /**
     * Get a human-readable description of a log level filter
     * 
     * @param input - The log level input to describe
     * @returns Human-readable description
     */
    static describe(input: LogLevelInput): string {
        try {
            const parsed = this.parse(input);
            const allTypesAtLevel = this.getTypesForLevel(parsed.lvl);

            if (parsed.types.length === allTypesAtLevel.length) {
                return `Level ${parsed.lvl} (${parsed.types.join(', ')})`;
            }

            return `Type '${parsed.types[0]}' (level ${parsed.lvl})`;
        } catch (error) {
            return `Invalid filter: ${input}`;
        }
    }
}
