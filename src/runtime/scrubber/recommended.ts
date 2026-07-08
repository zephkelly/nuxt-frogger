/**
 * `RECOMMENDED_RULES` — an opt-in bundle reproducing Frogger's pre-0.2 default
 * coverage, minus the over-broad bare `name` key (see {@link NAME_FIELDS}). It is
 * NOT applied automatically; pull it in explicitly:
 *
 * @example
 * import { defineScrub, RECOMMENDED_RULES } from '#frogger/config'
 * scrub: defineScrub().use(...RECOMMENDED_RULES).build()
 *
 * // or as a raw rules array
 * scrub: { rules: [...RECOMMENDED_RULES] }
 */

import type { ScrubRule } from "./types";
import { SCRUB_STRATEGY } from "./strategies";
import {
    PASSWORD_FIELDS,
    EMAIL_FIELDS,
    PHONE_FIELDS,
    NAME_FIELDS,
    ADDRESS_FIELDS,
} from "./field-lists";

export const RECOMMENDED_RULES: ScrubRule[] = [
    {
        action: SCRUB_STRATEGY.REDACT,
        fieldPatterns: PASSWORD_FIELDS,
        priority: 100,
        description: 'Redact passwords, secrets and tokens',
    },
    {
        action: SCRUB_STRATEGY.HASH,
        fieldPatterns: ['ssn', 'socialSecurity'],
        priority: 95,
        description: 'Hash government identifiers',
    },
    {
        action: SCRUB_STRATEGY.MASK_CARD,
        fieldPatterns: ['creditCard', 'cardNumber', 'accountNumber'],
        priority: 95,
        description: 'Mask card / account numbers (keep last 4)',
    },
    {
        action: SCRUB_STRATEGY.MASK_EMAIL,
        fieldPatterns: EMAIL_FIELDS,
        priority: 90,
        description: 'Mask email addresses',
    },
    {
        action: SCRUB_STRATEGY.MASK_PHONE,
        fieldPatterns: PHONE_FIELDS,
        priority: 90,
        description: 'Mask phone numbers',
    },
    {
        action: SCRUB_STRATEGY.KEEP_ENDS,
        fieldPatterns: NAME_FIELDS,
        priority: 80,
        description: 'Partially mask names and user identifiers',
    },
    {
        action: SCRUB_STRATEGY.KEEP_ENDS,
        fieldPatterns: ADDRESS_FIELDS,
        priority: 70,
        description: 'Partially mask address information',
    },
]
