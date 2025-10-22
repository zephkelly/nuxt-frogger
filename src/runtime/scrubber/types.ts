export const SCRUB_ACTION = {
    MASK_PARTIAL: 'mask_partial',
    MASK_FIRST_ONLY: 'mask_first',
    REDACT_FULL: 'redact_full',
    HASH_VALUE: 'hash_value',
    MASK_EMAIL: 'mask_email',
    MASK_PHONE: 'mask_phone',
} as const

export type ScrubAction = typeof SCRUB_ACTION[keyof typeof SCRUB_ACTION];

export interface ScrubRule {
    action: ScrubAction;
    fieldPatterns: (string | RegExp)[];
    priority: number;
    description?: string;
}

export interface ScrubberConfig {
    enabled: boolean;
    rules: ScrubRule[];
    deepScrub: boolean;
    preserveTypes: boolean;
    maxDepth: number;
}

export interface ScrubResult {
    scrubbed: boolean;
    fieldsModified: string[];
}