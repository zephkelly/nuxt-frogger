import type { ValuePattern } from './value-patterns';
import type { ScrubStrategy } from "./strategies";
import { SCRUB_STRATEGY } from "./strategies";

/**
 * Legacy action map (pre-0.2). Kept as an alias of the new {@link SCRUB_STRATEGY}
 * tokens so existing rule sets and serialised config keep resolving. New code
 * should use `SCRUB_STRATEGY` (or the fluent builder).
 */
export const SCRUB_ACTION = {
    MASK_PARTIAL: 'mask_partial',
    MASK_FIRST_ONLY: 'mask_first',
    REDACT_FULL: 'redact_full',
    HASH_VALUE: 'hash_value',
    MASK_EMAIL: 'mask_email',
    MASK_PHONE: 'mask_phone',
} as const

/**
 * A field pattern the scrubber matches against context keys. Plain strings are
 * matched case-insensitively by exact key name; RegExps by `.test()`. The
 * `{ source, flags }` form is the serialisation-safe representation a RegExp
 * compiles to when a rule set is written into runtime config — {@link LogScrubber}
 * reconstructs a RegExp from it.
 */
export type SerializedRegex = { source: string; flags: string }
export type FieldPattern = string | RegExp | SerializedRegex

/**
 * Any accepted action token: a current strategy, or a legacy `SCRUB_ACTION`
 * string. Both resolve through `normaliseStrategy` at apply time.
 */
export type ScrubAction = ScrubStrategy | typeof SCRUB_ACTION[keyof typeof SCRUB_ACTION];

export interface ScrubRule {
    action: ScrubAction;
    fieldPatterns: FieldPattern[];
    /** Higher wins across ALL rules, string and regex alike; an exact string match wins ties. */
    priority: number;
    description?: string;
}

export interface ScrubberConfig {
    enabled: boolean;
    rules: ScrubRule[];
    deepScrub: boolean;
    preserveTypes: boolean;
    /** Recursion bound for nested objects. `undefined` = no limit (cycle-safe). */
    maxDepth?: number;
    /** Value-shape patterns; see `ScrubberOptions.values`. Off by default. */
    values?: boolean | ValuePattern[];
    /** Also run value patterns over `msg`; see `ScrubberOptions.message`. */
    message?: boolean;
}

export interface ScrubResult {
    scrubbed: boolean;
    fieldsModified: string[];
}

export { SCRUB_STRATEGY };
export type { ScrubStrategy };
