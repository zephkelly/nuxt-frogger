export { defineFroggerOptions } from "./shared/utils/frogger-config";

// Declarative transport factories + their config types. Pure (no #imports), so
// they are importable from frogger.config.ts outside the Nuxt runtime.
export {
    fileTransport,
    httpTransport,
    observeTransport,
} from "./shared/transports/factories";
export type {
    FroggerTransportConfig,
    FileTransportConfig,
    HttpTransportConfig,
    ObserveTransportConfig,
} from "./shared/types/transports";

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
