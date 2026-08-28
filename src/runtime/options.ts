export { defineFroggerOptions } from "./shared/utils/frogger-config";

// Declarative transport factories + their config types. Pure (no #imports), so
// they are importable from frogger.config.ts outside the Nuxt runtime.
export {
    fileTransport,
    httpTransport,
    stdoutTransport,
    observeTransport,
    memoryTransport,
} from "./shared/transports/factories";
export type {
    FroggerTransportConfig,
    FileTransportConfig,
    HttpTransportConfig,
    ObserveTransportConfig,
    MemoryTransportConfig,
} from "./shared/types/transports";

// Metric-transport factories + config types. Pure (no #imports), importable
// from frogger.config.ts. Add these to `metrics.transports`, not `transports`.
export {
    metricFileTransport,
    metricMemoryTransport,
    metricObserveTransport,
} from "./metrics/shared/transports/factories";
export type {
    FroggerMetricTransportConfig,
    MetricFileTransportConfig,
    MetricMemoryTransportConfig,
    MetricObserveTransportConfig,
} from "./metrics/shared/types/metric-transports";
export type { MetricsOptions } from "./metrics/shared/types/metric-options";

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
