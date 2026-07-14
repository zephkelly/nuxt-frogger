import type { LoggerObject } from "../shared/types/log";
import { type ScrubberConfig, type ScrubRule, type ScrubResult, type FieldPattern } from "./types";
import { applyStrategy } from "./strategies";

import { defu } from "defu";


export class LogScrubber {
    private config: ScrubberConfig;
    private fieldRuleMap: Map<string, ScrubRule>;
    private regexRules: { pattern: RegExp; rule: ScrubRule }[];
    private scrubStats: { totalProcessed: number; totalScrubbed: number };
    private fieldRuleCache: Map<string, ScrubRule | null>;
    private readonly MAX_CACHE_SIZE = 1000;

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

        const exactMatch = this.fieldRuleMap.get(lowerFieldName);
        if (exactMatch) {
            this.cacheRule(fieldName, exactMatch);
            return exactMatch;
        }

        for (const { pattern, rule } of this.regexRules) {
            if (pattern.test(fieldName)) {
                this.cacheRule(fieldName, rule);
                return rule;
            }
        }

        this.cacheRule(fieldName, null);
        return null;
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

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    const item = value[i];
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


    public scrubLoggerObject(logObj: LoggerObject): ScrubResult {
        if (!this.config.enabled) {
            return { scrubbed: false, fieldsModified: [] };
        }

        this.scrubStats.totalProcessed++;

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
