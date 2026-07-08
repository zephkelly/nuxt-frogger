import type { FieldPattern, ScrubRule } from "./types";

/**
 * Compile a field pattern into a serialisation-safe form: a live RegExp becomes
 * `{ source, flags }` so it survives being written into Nuxt runtime config and
 * JSON-serialised across the SSR→client boundary. Strings and already-compiled
 * patterns pass through unchanged. {@link LogScrubber} reconstructs the RegExp.
 */
export function compileFieldPattern(pattern: FieldPattern): FieldPattern {
    if (pattern instanceof RegExp) {
        return { source: pattern.source, flags: pattern.flags }
    }
    return pattern
}

export function compileScrubRules(rules: ScrubRule[]): ScrubRule[] {
    return rules.map(rule => ({
        ...rule,
        fieldPatterns: rule.fieldPatterns.map(compileFieldPattern),
    }))
}
