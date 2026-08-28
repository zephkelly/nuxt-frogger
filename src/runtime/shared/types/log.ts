import type { LogType } from "consola";
import type { TraceContext } from "./trace-headers";
import type { FroggerResource } from "./resource";



export interface LogContext {
    [key: string]: any
}

// Stamped by an in-process server logger once its own scrub disposition (its
// rules, or an explicit `scrub: false`) has been applied, so the queue's
// module-level pass doesn't override a per-logger opt-out. A symbol key:
// network batches are parsed from JSON and can never carry it, so client rows
// always get the queue's unconditional scrub. The queue strips it before any
// transport sees the row. Symbol.for keeps the marker recognisable even if
// the runtime is bundled twice.
export const SCRUB_HANDLED: unique symbol = Symbol.for('frogger:scrub-handled');

export interface LoggerObject {
    /**
     * uuidv7, minted where the record is constructed and preserved unchanged
     * across relay hops. Time-ordered, so it doubles as a sort key and as the
     * dedupe key for a batch that was retried after a lost response.
     * `trace.spanId` cannot serve this purpose: it is chained and repeats.
     */
    id: string;
    time: number;
    /**
     * Epoch ms the collector observed this record, denormalised from
     * `meta.received.at` at ingest. Mirrors OTel's Timestamp /
     * ObservedTimestamp split: `time` is what the emitter claimed, `obsTime` is
     * what the collector saw. Absent on a row that has not crossed ingest.
     */
    obsTime?: number;
    /**
     * Frogger's verbosity level: LOWER is more important, and this is what the
     * logger's threshold gates on. Always finite and JSON-safe.
     */
    lvl: number;
    /**
     * OpenTelemetry SeverityNumber (trace=1, debug=5, info=9, warn=13,
     * error=17, fatal=21). Derived from `type`, so it increases with
     * seriousness - the opposite direction to {@link lvl} - and gives a reader
     * a standard axis without renaming anything user-facing.
     */
    sev: number;
    type: LogType;

    /**
     * What this record IS, as opposed to how severe it is.
     *
     * `'event'` marks a deliberate business fact recorded through
     * `frogger.event()` - an order placed, a plan upgraded. Absent means an
     * ordinary diagnostic log. One predicate splits the two, which is what
     * lets a reader build an activity feed without heuristics over `msg`, and
     * lets a transport route them separately via `minLevel`.
     */
    kind?: 'event';

    msg: string;
    ctx: LogContext;
    env: 'ssr' | 'csr' | 'client' | 'server';
    source?: {
        name: string;
        version: string;
    };
    trace: TraceContext;

    /**
     * Session this row belongs to. Defaults to the browser session, which the
     * metrics pipeline also sends, so a log and a Web Vital from the same page
     * load join on it.
     *
     * That join holds only for the default. `setSession()` may pin a different
     * id (an auth session, say), and metrics keeps sending the browser id, so
     * an override splits the column by pipeline. Deliberate, but not free.
     *
     * TOP-LEVEL, not a `ctx` key, and NEVER SCRUBBED. `ctx` is user-owned and
     * arbitrarily shaped; these three are the reader's index keys and must be
     * guaranteed present and unmodified wherever they apply.
     */
    session?: { id: string; sampled: boolean };

    /**
     * Correlation id for the acting user. Set via `frogger.identify()`.
     * Top-level and never scrubbed, for the same reason as {@link session}.
     */
    user?: string;

    /**
     * The matched ROUTE PATTERN (`/orders/[id]`), never a raw path. A raw path
     * is unbounded cardinality and frequently carries ids in the URL.
     * Top-level and never scrubbed.
     */
    route?: string;

    /**
     * Deployment identity, denormalised from the batch envelope at ingest.
     * Absent on a row that has not crossed an ingest route yet.
     */
    resource?: FroggerResource;
    [SCRUB_HANDLED]?: true;
}

export const LOG_LEVELS = {
    0: ['fatal', 'error'],
    1: ['warn'],
    2: ['log'],
    3: ['info', 'success', 'fail', 'ready', 'start'],
    4: ['debug'],
    5: ['trace', 'verbose'],
    '-1': ['silent']
} as const;

/**
 * Frogger's own verbosity ordering, and the source of `LoggerObject.lvl`.
 *
 * Every value here is FINITE and JSON-safe. `lvl` used to be copied straight
 * off consola's LogObject, where `silent` is -Infinity and `verbose` is
 * +Infinity - both of which `JSON.stringify` turns into `null`, so those rows
 * reached every transport with a null level. Worse, consola gates on
 * `level > this.level`, so a `verbose` level of +Infinity could not fire at any
 * finite configured threshold: the method was unreachable by construction.
 *
 * `verbose` is folded into the same tier as `trace` rather than given a
 * number above it: it is consola's "even more than trace" escape hatch, and
 * frogger has no use for a tier nothing can be configured to admit.
 */
export const LEVEL_TO_NUMBER: Record<string, number> = {
    'fatal': 0,
    'error': 0,
    'warn': 1,
    'log': 2,
    'info': 3,
    'success': 3,
    'fail': 3,
    'ready': 3,
    'start': 3,
    'debug': 4,
    'trace': 5,
    'verbose': 5,
    'silent': -1
};

/**
 * OpenTelemetry SeverityNumber per log type, derived from `type` rather than
 * from frogger's own `lvl`.
 *
 * `lvl` is a verbosity threshold (lower = more important, and it is what the
 * logger gates on); `sev` is a standard severity axis that only ever increases
 * with seriousness. Readers and any OTLP shaper index on `sev`; nothing
 * user-facing is renamed to get it.
 */
export const LEVEL_TO_SEVERITY: Record<string, number> = {
    'trace': 1,
    'verbose': 1,
    'debug': 5,
    'log': 9,
    'info': 9,
    'success': 9,
    'ready': 9,
    'start': 9,
    'warn': 13,
    'fail': 17,
    'error': 17,
    'fatal': 21,
    'silent': 0
};

/** OTel SeverityNumber for a consola log type, defaulting to INFO. */
export function severityOf(type: string): number {
    return LEVEL_TO_SEVERITY[type] ?? LEVEL_TO_SEVERITY.info!;
}

/** Frogger's numeric level for a consola log type, defaulting to `log`. */
export function levelOf(type: string): number {
    return LEVEL_TO_NUMBER[type] ?? LEVEL_TO_NUMBER.log!;
}