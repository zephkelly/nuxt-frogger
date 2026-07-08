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
        // via the WeakSet guard in scrubObject).
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

    private scrubObject(obj: any, depth: number = 0, visited = new WeakSet()): { modified: boolean; fieldsModified: string[] } {
        if (!obj || (this.config.maxDepth !== undefined && depth > this.config.maxDepth)) {
            return { modified: false, fieldsModified: [] };
        }

        if (typeof obj !== 'object') {
            return { modified: false, fieldsModified: [] };
        }

        if (visited.has(obj)) {
            return { modified: false, fieldsModified: [] };
        }

        visited.add(obj);

        let modified = false;
        const fieldsModified: string[] = [];

        try {
            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    const item = obj[i];
                    if (item && typeof item === 'object') {
                        const nestedResult = this.scrubObject(item, depth + 1, visited);
                        if (nestedResult.modified) {
                            modified = true;
                            fieldsModified.push(...nestedResult.fieldsModified.map(field => `[${i}].${field}`));
                        }
                    }
                }
            }
            else {
                for (const [key, value] of Object.entries(obj)) {
                    const rule = this.findRule(key);

                    if (rule) {
                        const scrubbedValue = this.applyScrubAction(value, rule);
                        if (scrubbedValue !== value) {
                            obj[key] = scrubbedValue;
                            modified = true;
                            fieldsModified.push(key);
                        }
                    }
                    else if (this.config.deepScrub && value && typeof value === 'object') {
                        const nestedResult = this.scrubObject(value, depth + 1, visited);
                        if (nestedResult.modified) {
                            modified = true;
                            fieldsModified.push(...nestedResult.fieldsModified.map(field => `${key}.${field}`));
                        }
                    }
                }
            }
        }
        finally {
            visited.delete(obj);
        }

        return { modified, fieldsModified };
    }


    public scrubLoggerObject(logObj: LoggerObject): ScrubResult {
        if (!this.config.enabled) {
            return { scrubbed: false, fieldsModified: [] };
        }

        this.scrubStats.totalProcessed++;

        const result = this.scrubObject(logObj.ctx);

        if (result.modified) {
            this.scrubStats.totalScrubbed++;
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
