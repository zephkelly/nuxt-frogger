/**
 * Fluent builder for scrub configuration.
 *
 * Nothing is scrubbed unless you declare it here — Frogger ships zero active
 * rules even when scrubbing is enabled. Each method opts one strategy into one
 * or more fields; `.build()` returns a serialisable {@link ScrubberOptions}.
 *
 * @example
 * import { defineScrub, fields } from '#frogger/config'
 *
 * export default defineFroggerOptions({
 *   scrub: defineScrub()
 *     .redact(fields.passwords, 'apiSecret')
 *     .maskEmail(fields.emails)
 *     .keepEnds(fields.names, /customer.*name/i)
 *     .build(),
 * })
 */

import type { ScrubberOptions } from "./options";
import type { FieldPattern, ScrubRule, ScrubAction } from "./types";
import { SCRUB_STRATEGY } from "./strategies";
import { compileScrubRules } from "./compile";
import { fields } from "./field-lists";

export { fields };

/** A field argument: a single pattern or a field-list array (spread and flattened). */
type FieldArg = FieldPattern | FieldPattern[]

interface ScrubBuilderOptions {
    maxDepth?: number
    deepScrub?: boolean
    preserveTypes?: boolean
}

function flatten(args: FieldArg[]): FieldPattern[] {
    return args.flat() as FieldPattern[]
}

class ScrubBuilder {
    private rules: ScrubRule[] = []
    private options: ScrubBuilderOptions

    constructor(options: ScrubBuilderOptions = {}) {
        this.options = options
    }

    private add(action: ScrubAction, args: FieldArg[], priority = 100): this {
        const fieldPatterns = flatten(args)
        if (fieldPatterns.length > 0) {
            this.rules.push({ action, fieldPatterns, priority })
        }
        return this
    }

    redact(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.REDACT, f) }
    maskAll(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.MASK_ALL, f) }
    keepFirst(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.KEEP_FIRST, f) }
    keepLast(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.KEEP_LAST, f) }
    keepEnds(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.KEEP_ENDS, f) }
    hash(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.HASH, f) }
    maskEmail(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.MASK_EMAIL, f) }
    maskPhone(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.MASK_PHONE, f) }
    maskCard(...f: FieldArg[]): this { return this.add(SCRUB_STRATEGY.MASK_CARD, f) }

    /** Escape hatch: add a fully-specified rule (custom action, priority, description). */
    rule(rule: { action: ScrubAction; fields: FieldArg[]; priority?: number; description?: string }): this {
        const fieldPatterns = flatten(rule.fields)
        if (fieldPatterns.length > 0) {
            this.rules.push({
                action: rule.action,
                fieldPatterns,
                priority: rule.priority ?? 100,
                description: rule.description,
            })
        }
        return this
    }

    /** Spread in pre-built rules, e.g. `.use(...RECOMMENDED_RULES)`. */
    use(...rules: ScrubRule[]): this {
        this.rules.push(...rules)
        return this
    }

    maxDepth(n: number): this { this.options.maxDepth = n; return this }
    deepScrub(enabled: boolean): this { this.options.deepScrub = enabled; return this }
    preserveTypes(enabled: boolean): this { this.options.preserveTypes = enabled; return this }

    build(): ScrubberOptions {
        return {
            ...this.options,
            rules: compileScrubRules(this.rules),
        }
    }
}

export function defineScrub(options: ScrubBuilderOptions = {}): ScrubBuilder {
    return new ScrubBuilder(options)
}
