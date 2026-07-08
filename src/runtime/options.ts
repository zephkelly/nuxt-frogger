export { defineFroggerOptions } from "./shared/utils/frogger-config";

// Scrub primitives — provided for composition, never applied automatically.
export { defineScrub, fields } from "./scrubber/builder";
export { RECOMMENDED_RULES } from "./scrubber/recommended";
export {
    PASSWORD_FIELDS,
    EMAIL_FIELDS,
    PHONE_FIELDS,
    NAME_FIELDS,
    FINANCIAL_FIELDS,
    ADDRESS_FIELDS,
} from "./scrubber/field-lists";
export { SCRUB_STRATEGY } from "./scrubber/strategies";
export type { ScrubStrategy } from "./scrubber/strategies";
export type { ScrubRule, ScrubAction, FieldPattern } from "./scrubber/types";
