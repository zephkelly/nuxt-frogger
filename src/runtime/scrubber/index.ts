import { DEFAULT_VALUE_PATTERNS, scrubStringValue, type ValuePattern } from './value-patterns';
import type { LoggerObject } from "../shared/types/log";
import { type ScrubberConfig, type ScrubRule, type ScrubResult, type FieldPattern } from "./types";
import { applyStrategy } from "./strategies";

import { defu } from "defu";


/**
 * Convert a container the scrubber cannot see inside into one it can.
 *
 * `Object.entries` returns `[]` for `Map`, `Set` and `Headers`, so the generic
 * object branch found nothing to scrub and passed the instance through by
 * reference. This is the mechanism behind the unredacted-headers leak.
 *
 * Other class instances are deliberately left alone and returned `null`:
 * walking an arbitrary class is how a scrubber ends up serialising a database
 * connection into a log row. That is now an explicit decision rather than an
 * accident of `Object.entries`.
 */
function toScrubbableContainer(value: object): { plain: unknown } | null {
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
        const plain: Record<string, string> = {}
        for (const [key, entry] of (value as Headers).entries()) plain[key] = entry
        return { plain }
    }

    if (value instanceof Map) {
        const plain: Record<string, unknown> = {}
        for (const [key, entry] of value.entries()) plain[String(key)] = entry
        return { plain }
    }

    if (value instanceof Set) {
        return { plain: Array.from(value) }
    }

    return null
}

export class LogScrubber {
    private config: ScrubberConfig;
    private fieldRuleMap: Map<string, ScrubRule>;
    private regexRules: { pattern: RegExp; rule: ScrubRule }[];
    private scrubStats: { totalProcessed: number; totalScrubbed: number };
    private fieldRuleCache: Map<string, ScrubRule | null>;
    private readonly MAX_CACHE_SIZE = 1000;

    /**
     * Value-shape patterns, or `null` when off (the default). Resolved once so
     * the hot path is a null check rather than an option lookup.
     */
    private valuePatterns: ValuePattern[] | null = null;

    constructor(config: Partial<ScrubberConfig> = {}) {
        // No default rules: scrubbing is fully opt-in. An enabled scrubber with
        // an empty rule set is a deliberate no-op (see the dev-time notice).
        // maxDepth has no default: undefined = unlimited recursion (cycle-safe
        // via the WeakSet guard in scrubValue).
        this.config = defu(config, {
            enabled: true,
            rules: [] as ScrubRule[],
            deepScrub: true,
            preserveTypes: true,
        }) as ScrubberConfig;

        // Opt-in: running regexes over every string in every log is a real
        // cost, so an unset option means "do not".
        const values = (config as { values?: boolean | ValuePattern[] }).values;
        if (values === true) {
            this.valuePatterns = DEFAULT_VALUE_PATTERNS;
        }
        else if (Array.isArray(values) && values.length > 0) {
            this.valuePatterns = values;
        }

        this.fieldRuleMap = new Map();
        this.regexRules = [];
        this.fieldRuleCache = new Map();
        this.scrubStats = { totalProcessed: 0, totalScrubbed: 0 };

        this.buildRuleMaps();
    }

    private toRegExp(pattern: FieldPattern): RegExp | null {
        if (pattern instanceof RegExp) return pattern;
        if (typeof pattern === 'object' && pattern !== null && typeof pattern.source === 'string') {
            try {
                return new RegExp(pattern.source, pattern.flags);
            }
            catch {
                return null;
            }
        }
        return null;
    }

    private buildRuleMaps(): void {
        this.fieldRuleMap.clear();
        this.regexRules = [];
        this.fieldRuleCache.clear();

        const sortedRules = [...this.config.rules].sort((a, b) => b.priority - a.priority);

        for (const rule of sortedRules) {
            for (const pattern of rule.fieldPatterns) {
                if (typeof pattern === 'string') {
                    if (!this.fieldRuleMap.has(pattern.toLowerCase())) {
                        this.fieldRuleMap.set(pattern.toLowerCase(), rule);
                    }
                }
                else {
                    const regex = this.toRegExp(pattern);
                    if (regex) this.regexRules.push({ pattern: regex, rule });
                }
            }
        }
    }

    private findRule(fieldName: string): ScrubRule | null {
        if (this.fieldRuleCache.has(fieldName)) {
            return this.fieldRuleCache.get(fieldName)!;
        }

        const lowerFieldName = fieldName.toLowerCase();
        const exactMatch = this.fieldRuleMap.get(lowerFieldName) ?? null;

        // Priority decides across BOTH pattern kinds; an exact string match
        // only breaks ties. regexRules is sorted by descending priority, so
        // the scan stops as soon as a regex can no longer outrank the exact
        // match.
        let chosen = exactMatch;
        for (const { pattern, rule } of this.regexRules) {
            if (exactMatch && rule.priority <= exactMatch.priority) {
                break;
            }
            if (pattern.test(fieldName)) {
                chosen = rule;
                break;
            }
        }

        this.cacheRule(fieldName, chosen);
        return chosen;
    }

    private cacheRule(fieldName: string, rule: ScrubRule | null): void {
        if (this.fieldRuleCache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.fieldRuleCache.keys().next().value;

            if (firstKey !== undefined) {
                this.fieldRuleCache.delete(firstKey);
            }
        }
        this.fieldRuleCache.set(fieldName, rule);
    }

    private applyScrubAction(value: any, rule: ScrubRule): any {
        return applyStrategy(value, rule.action, { preserveTypes: this.config.preserveTypes });
    }

    /**
     * Shallow-clone an object or array, preserving its prototype so a class
     * instance keeps its methods / `toJSON` and an array stays an array. Used to
     * copy a node on first write (see {@link scrubValue}).
     */
    private shallowClone<T extends object>(value: T): T {
        if (Array.isArray(value)) {
            return value.slice() as unknown as T;
        }
        return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
    }

    /**
     * Return a scrubbed copy of `value`, never mutating the input. Nodes are
     * copied on write (copy-on-first-scrub): a subtree with nothing to scrub is
     * returned by reference and shared with the original, and only the spine of
     * nodes leading to a scrubbed value is cloned. This guarantees the caller's
     * object graph (including persistent global context) is left untouched while
     * keeping allocations proportional to what actually changed.
     */
    private scrubValue(value: any, depth: number, visited: WeakSet<object>): { value: any; modified: boolean; fieldsModified: string[] } {
        if (!value || typeof value !== 'object') {
            return { value, modified: false, fieldsModified: [] };
        }

        if (this.config.maxDepth !== undefined && depth > this.config.maxDepth) {
            return { value, modified: false, fieldsModified: [] };
        }

        // Cycle guard: an object already on the current path is returned as-is so
        // the copy keeps referencing the original at the cycle point (matching the
        // prior skip-on-revisit behaviour) without infinite recursion.
        if (visited.has(value)) {
            return { value, modified: false, fieldsModified: [] };
        }

        visited.add(value);

        try {
            let modified = false;
            const fieldsModified: string[] = [];
            let result = value;

            // Map, Set and Headers all walk to `[]` under `Object.entries`,
            // so the generic branch below sees no entries and returns them by
            // reference - unredacted. Convert to a plain object (Headers, Map)
            // or array (Set) on the COPY so their contents are actually
            // reachable by the rules.
            const container = toScrubbableContainer(value);
            if (container) {
                const nested = this.scrubValue(container.plain, depth, visited);
                // Always modified: the container itself had to be replaced for
                // its contents to be inspectable downstream at all.
                return { value: nested.value, modified: true, fieldsModified: nested.fieldsModified };
            }

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    const item = value[i];

                    if (this.valuePatterns && typeof item === 'string') {
                        const scrubbed = scrubStringValue(item, this.valuePatterns);
                        if (scrubbed !== item) {
                            if (result === value) result = this.shallowClone(value);
                            result[i] = scrubbed;
                            modified = true;
                            fieldsModified.push(`[${i}]`);
                        }
                        continue;
                    }

                    if (item && typeof item === 'object') {
                        const nested = this.scrubValue(item, depth + 1, visited);
                        if (nested.modified) {
                            if (result === value) result = this.shallowClone(value);
                            result[i] = nested.value;
                            modified = true;
                            fieldsModified.push(...nested.fieldsModified.map(field => `[${i}].${field}`));
                        }
                    }
                }
            }
            else {
                for (const [key, entryValue] of Object.entries(value)) {
                    const rule = this.findRule(key);

                    if (rule) {
                        const scrubbedValue = this.applyScrubAction(entryValue, rule);
                        if (scrubbedValue !== entryValue) {
                            if (result === value) result = this.shallowClone(value);
                            result[key] = scrubbedValue;
                            modified = true;
                            fieldsModified.push(key);
                        }
                    }
                    else if (this.valuePatterns && typeof entryValue === 'string') {
                        // No key rule matched, but the VALUE may still look
                        // like a secret - a token pasted into a `note` field.
                        const scrubbed = scrubStringValue(entryValue, this.valuePatterns);
                        if (scrubbed !== entryValue) {
                            if (result === value) result = this.shallowClone(value);
                            result[key] = scrubbed;
                            modified = true;
                            fieldsModified.push(key);
                        }
                    }
                    else if (this.config.deepScrub && entryValue && typeof entryValue === 'object') {
                        const nested = this.scrubValue(entryValue, depth + 1, visited);
                        if (nested.modified) {
                            if (result === value) result = this.shallowClone(value);
                            result[key] = nested.value;
                            modified = true;
                            fieldsModified.push(...nested.fieldsModified.map(field => `${key}.${field}`));
                        }
                    }
                }
            }

            return { value: result, modified, fieldsModified };
        }
        finally {
            visited.delete(value);
        }
    }


    /**
     * Scrub a log row's context.
     *
     * ONLY `ctx` is touched, and that is a deliberate invariant, not an
     * oversight: `ctx` is user-owned and arbitrarily shaped, whereas the
     * top-level `session`, `user` and `route` fields are the reader's index
     * keys. Redacting them would break every join a backend can perform while
     * protecting nothing - `user` is already a correlation id, not a name, and
     * `route` is a pattern, not a path.
     */
    public scrubLoggerObject(logObj: LoggerObject): ScrubResult {
        if (!this.config.enabled) {
            return { scrubbed: false, fieldsModified: [] };
        }

        this.scrubStats.totalProcessed++;

        // The message is opt-in separately from context: it is the line a
        // developer reads to understand what happened, so redacting inside it
        // is a bigger behavioural change than redacting a context field.
        if (this.valuePatterns && this.config.message && typeof logObj.msg === 'string') {
            const scrubbedMsg = scrubStringValue(logObj.msg, this.valuePatterns);
            if (scrubbedMsg !== logObj.msg) {
                logObj.msg = scrubbedMsg;
            }
        }

        const result = this.scrubValue(logObj.ctx, 0, new WeakSet());

        if (result.modified) {
            this.scrubStats.totalScrubbed++;
            // Swap in the scrubbed copy; the caller's original ctx graph is never
            // mutated (copy-on-write above), so redaction can't leak back into the
            // object the developer passed to the logger.
            logObj.ctx = result.value;
        }

        return {
            scrubbed: result.modified,
            fieldsModified: result.fieldsModified,
        };
    }

    /**
     * Scrub an arbitrary record with the same rules, copy-on-write semantics
     * and depth bound as a log's `ctx`, returning the scrubbed copy rather than
     * swapping it into a carrier object. This is what lets a non-log pipeline
     * (metric labels and attributes) reuse the one ruleset instead of growing a
     * second, weaker redaction path.
     */
    public scrubRecord<T>(value: T): { value: T; modified: boolean; fieldsModified: string[] } {
        if (!this.config.enabled) {
            return { value, modified: false, fieldsModified: [] };
        }

        this.scrubStats.totalProcessed++;

        const result = this.scrubValue(value, 0, new WeakSet());
        if (result.modified) {
            this.scrubStats.totalScrubbed++;
        }

        return { value: result.value as T, modified: result.modified, fieldsModified: result.fieldsModified };
    }

    public scrubBatch(batch: LoggerObject[]): ScrubResult[] {
        const results: ScrubResult[] = [];

        for (const logObj of batch) {
            results.push(this.scrubLoggerObject(logObj));
        }

        return results;
    }

    public addRule(rule: ScrubRule): void {
        this.config.rules.push(rule);
        this.buildRuleMaps();
    }

    public removeRule(description: string): void {
        this.config.rules = this.config.rules.filter(rule => rule.description !== description);
        this.buildRuleMaps();
    }

    public updateConfig(config: Partial<ScrubberConfig>): void {
        this.config = { ...this.config, ...config };
        this.buildRuleMaps();
    }

    public getStats(): { totalProcessed: number; totalScrubbed: number; scrubRate: number } {
        return {
            ...this.scrubStats,
            scrubRate: this.scrubStats.totalProcessed > 0
                ? this.scrubStats.totalScrubbed / this.scrubStats.totalProcessed
                : 0
        };
    }

    public resetStats(): void {
        this.scrubStats = { totalProcessed: 0, totalScrubbed: 0 };
    }

    public wouldScrub(fieldName: string): { wouldScrub: boolean; rule?: ScrubRule } {
        const rule = this.findRule(fieldName);
        return {
            wouldScrub: rule !== null,
            rule: rule || undefined
        };
    }
}
