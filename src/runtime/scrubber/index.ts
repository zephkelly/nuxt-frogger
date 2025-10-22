import type { LoggerObject } from "../shared/types/log";
import { type ScrubberConfig, type ScrubRule, type ScrubResult, type ScrubAction, SCRUB_ACTION } from "./types";

import { defu } from "defu";


export class LogScrubber {
    private config: ScrubberConfig;
    private fieldRuleMap: Map<string, ScrubRule>;
    private regexRules: { pattern: RegExp; rule: ScrubRule }[];
    private scrubStats: { totalProcessed: number; totalScrubbed: number };
    private fieldRuleCache: Map<string, ScrubRule | null>;
    private readonly MAX_CACHE_SIZE = 1000;

    constructor(config: Partial<ScrubberConfig> = {}) {
        this.config = defu(config, {
            enabled: true,
            rules: this.getDefaultRules(),
            deepScrub: true,
            preserveTypes: true,
            maxDepth: 10
        }) as ScrubberConfig;

        this.fieldRuleMap = new Map();
        this.regexRules = [];
        this.fieldRuleCache = new Map()
        this.scrubStats = { totalProcessed: 0, totalScrubbed: 0 };

        this.buildRuleMaps();
    }

    private getDefaultRules(): ScrubRule[] {
        return [
            {
                action: SCRUB_ACTION.REDACT_FULL,
                fieldPatterns: ['password', 'passwd', 'pwd', 'secret', 'token', 'key', 'apikey', 'api_key'],
                priority: 100,
                description: 'Remove passwords and secrets completely'
            },
            {
                action: SCRUB_ACTION.MASK_EMAIL,
                fieldPatterns: ['email', 'e_mail', 'emailAddress', 'userEmail', /.*email.*/i],
                priority: 90,
                description: 'Mask email addresses'
            },
            {
                action: SCRUB_ACTION.MASK_PHONE,
                fieldPatterns: ['phone', 'phoneNumber', 'mobile', 'cell', /.*phone.*/i],
                priority: 90,
                description: 'Mask phone numbers'
            },
            {
                action: SCRUB_ACTION.MASK_PARTIAL,
                fieldPatterns: ['name', 'firstName', 'lastName', 'fullName', 'username', 'userId'],
                priority: 80,
                description: 'Partially mask names and user identifiers'
            },
            {
                action: SCRUB_ACTION.HASH_VALUE,
                fieldPatterns: ['ssn', 'socialSecurity', 'creditCard', 'cardNumber', 'accountNumber'],
                priority: 95,
                description: 'Hash sensitive numeric identifiers'
            },
            {
                action: SCRUB_ACTION.MASK_PARTIAL,
                fieldPatterns: ['address', 'street', 'city', 'zipCode', 'postalCode'],
                priority: 70,
                description: 'Mask address information'
            }
        ];
    }

    private buildRuleMaps(): void {
        this.fieldRuleMap.clear();
        this.regexRules = [];

        const sortedRules = [...this.config.rules].sort((a, b) => b.priority - a.priority);

        for (const rule of sortedRules) {
            for (const pattern of rule.fieldPatterns) {
                if (typeof pattern === 'string') {
                    if (!this.fieldRuleMap.has(pattern.toLowerCase())) {
                        this.fieldRuleMap.set(pattern.toLowerCase(), rule);
                    }
                }
                else if (pattern instanceof RegExp) {
                    this.regexRules.push({ pattern, rule });
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

    private isEmptyValue(value: any): boolean {
        if (typeof value === 'string') {
            return value.trim() === '';
        }

        if (Array.isArray(value)) {
            return value.length === 0;
        }

        if (typeof value === 'object' && value !== null) {
            return Object.keys(value).length === 0;
        }

        return false;
    }

    private applyScrubAction(value: any, action: ScrubAction): any {
        if (value === null || value === undefined) return value;

        if (this.isEmptyValue(value)) return value;

        const strValue = String(value);

        switch (action) {
            case SCRUB_ACTION.REDACT_FULL:
                return this.config.preserveTypes && typeof value === 'number' ? 0 : '[REDACTED]';

            case SCRUB_ACTION.MASK_FIRST_ONLY:
                if (strValue.length <= 1) return '*';
                return strValue[0] + '*'.repeat(strValue.length - 1);

            case SCRUB_ACTION.MASK_PARTIAL:
                if (strValue.length < 2) return '*';
                if (strValue.length < 7) {
                    return strValue[0] + '*'.repeat(strValue.length - 1);
                }
                return strValue[0] + '*'.repeat(5) + strValue[strValue.length - 1];

            case SCRUB_ACTION.HASH_VALUE:
                return this.simpleHash(strValue);

            case SCRUB_ACTION.MASK_EMAIL:
                return this.maskEmail(strValue);

            case SCRUB_ACTION.MASK_PHONE:
                return this.maskPhone(strValue);

            default:
                return value;
        }
    }

    private maskEmail(email: string): string {
        const emailRegex = /^([^@]+)@(.+)$/;
        const match = email.match(emailRegex);

        if (!match) return email;

        const [, localPart, domain] = match;
        if (localPart.length <= 1) return `*@${domain}`;

        return `${localPart[0]}***@${domain}`;
    }

    private maskPhone(phone: string): string {
        const chars = phone.split('');
        const digitIndices: number[] = [];

        for (let i = 0; i < chars.length; i++) {
            if (/\d/.test(chars[i])) {
                digitIndices.push(i);
            }
        }

        if (digitIndices.length < 4) return phone;

        for (let i = 1; i < digitIndices.length - 1; i++) {
            chars[digitIndices[i]] = '*';
        }

        return chars.join('');
    }

    private simpleHash(input: string): string {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `[HASH:${Math.abs(hash).toString(16)}]`;
    }

    private scrubObject(obj: any, depth: number = 0, visited = new WeakSet()): { modified: boolean; fieldsModified: string[] } {
        if (!obj || depth > this.config.maxDepth) {
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
                        const scrubbedValue = this.applyScrubAction(value, rule.action);
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