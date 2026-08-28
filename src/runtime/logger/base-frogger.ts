import { type Ref, ref, computed } from "vue";
import { type ConsolaInstance, createConsola } from "consola/core";
import { generateTraceId, generateSpanId, generateW3CTraceHeaders } from "../shared/utils/trace-headers";

import type { LogType, LogObject } from 'consola';
import type { LoggerObject } from "../shared/types/log";
import { levelOf } from "../shared/types/log";
import type { IFroggerLogger, AddContextOptions } from "./types";
import type { FroggerOptions } from "../shared/types/options";
import type { LogContext } from "../shared/types/log";
import type { TraceContext } from "../shared/types/trace-headers";
import { ConsoleReporter } from "./_reporters/console-reporter";
import { froggerInternal } from "../shared/utils/internal-log";
import { recordPipelineError } from "../shared/utils/health";

import type { IFroggerReporter } from "./_reporters/types";
import { LogScrubber } from "../scrubber";
import type { ScrubberOptions } from "../scrubber/options";
import { spanEventsFromConfig, type ResolvedSpanEvents, type SpanOptions } from "../shared/utils/span-events";
import { getSpanMetricSink, type SpanExemplar } from "../shared/utils/span-metric-sink";

import { useFroggerConfig } from "../shared/utils/use-frogger-config";
import { defu } from 'defu';



/**
 * Resolve a logger's numeric threshold from a per-logger option and the
 * module-wide setting. Names are the documented surface; a raw number stays
 * accepted as the low-level escape hatch.
 */
function resolveLoggerLevel(
    perLogger: LogType | number | undefined,
    moduleLevel: LogType | undefined,
): number {
    if (typeof perLogger === 'number') return perLogger;
    if (typeof perLogger === 'string') return levelOf(perLogger);
    if (moduleLevel) return levelOf(moduleLevel);
    return levelOf('info');
}

/**
 * Internal marker moved from context onto the row's `kind` field. A symbol so
 * it can never collide with a user context key, and so it cannot survive
 * JSON - an inbound network batch can't forge an event.
 */
export const EVENT_MARKER: unique symbol = Symbol.for('frogger:event');

export abstract class BaseFroggerLogger implements IFroggerLogger {
    protected consola: ConsolaInstance;
    protected globalContext: Ref<LogContext> = ref({});
    protected parentGlobalContext: Ref<LogContext> | null = null;

    protected appInfo?: {
        name?: string;
        version?: string;
    }

    protected readonly mergedGlobalContext: Ref<LogContext> = computed(() => {
        return defu(this.globalContext.value, this.parentGlobalContext?.value || {});
    });

    protected traceId: string;

    /**
     * THE span this logger represents, minted once at construction and stable
     * for its whole life. Every row it emits carries this id.
     *
     * It used to be re-minted on every single log call, so no two rows ever
     * shared a spanId and "the logs inside this span" was not expressible at
     * all. A reader had to walk a flat chain across thousands of rows and guess
     * where the boundaries were.
     */
    protected spanId: string;

    /**
     * The span that created this logger: its parent edge. Set at construction
     * (or by a trace continuation), never mutated by logging - which is what
     * makes the tree deterministic regardless of how many rows the parent
     * emitted first.
     */
    protected parentSpanId: string | null = null;

    /**
     * The last span id handed to the browser for the SSR -> CSR handoff. This
     * is the ONE place "continue from the last server span" is the correct
     * semantic, which is why it survives the move to stable spans.
     */
    protected lastSpanId: string | null = null;

    /**
     * The W3C trace-flags byte for this trace. Frogger PROPAGATES an upstream
     * sampling decision; it does not make one, so an absent decision defaults
     * to sampled (`01`) rather than being invented per hop.
     */
    protected traceFlags: string = '01';

    /** Inbound `tracestate`, carried forward so multi-hop vendor state survives. */
    protected inboundTracestate: string | undefined;

    /** Correlation id for the acting user, set via {@link identify}. */
    protected user: string | undefined;

    /** This span's own attributes, set via {@link setAttribute}. Bounded at emit. */
    protected spanAttributes: Record<string, string | number | boolean> | undefined;

    /** Matched route pattern for rows emitted here, never a raw path. */
    protected route: string | undefined;

    /** Browser session this logger belongs to, shared with the metrics queue. */
    protected session: { id: string; sampled: boolean } | undefined;

    protected level: number;
    protected readonly consoleOutput: boolean;
    protected readonly scrub: boolean;
    protected readonly spanEvents: ResolvedSpanEvents;

    private customReporters: IFroggerReporter[] = [];
    private consoleReporter: ConsoleReporter | null = null;
    private scrubber: LogScrubber | null = null;


    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.spanId = generateSpanId();

        const config = useFroggerConfig();

        // Threshold precedence: per-logger option > module `level` for this
        // runtime > `info`. Read tolerantly: a runtimeConfig written by an
        // older build has no `level` key at all, and that must degrade to the
        // default rather than to `undefined`.
        const moduleLevel = config.level;

        const scopedModuleLevel = typeof moduleLevel === 'string'
            ? moduleLevel
            : moduleLevel?.[this.getConsoleScope()];

        this.level = resolveLoggerLevel(options.level, scopedModuleLevel);

        const moduleConsoleOutput = config.consoleOutput as
            | boolean
            | { client?: boolean; server?: boolean }
            | undefined;

        // The resolver always hands us a per-runtime pair, but runtime config can
        // be overridden wholesale from nuxt.config, so a bare boolean is honoured
        // rather than silently ignored.
        const moduleDefault = typeof moduleConsoleOutput === 'boolean'
            ? moduleConsoleOutput
            : moduleConsoleOutput?.[this.getConsoleScope()];

        // Per-logger consoleOutput overrides the module default, which overrides
        // `true`. Note `??` rather than `!== false`: an explicit per-logger
        // `true` must be able to re-enable the console for one logger under a
        // module-wide `consoleOutput: false`.
        this.consoleOutput = options.consoleOutput ?? moduleDefault ?? true;

        // Per-logger scrub overrides module config: `false` opts this logger
        // out entirely, an object REPLACES the module rules (compose module
        // rules back in explicitly via defineScrub().use(...) if wanted), and
        // `true`/unset falls back to whatever the module resolved.
        const moduleScrub = config.scrub;
        const resolvedScrub = options.scrub === false
            ? false
            : (typeof options.scrub === 'object' && options.scrub !== null)
                ? options.scrub
                : moduleScrub;

        this.scrub = Boolean(resolvedScrub);

        if (resolvedScrub) {
            this.scrubber = new LogScrubber(resolvedScrub);
        }

        // Span-end events default ON at info with no duration metric; `spans:
        // false` turns them off. Read tolerantly rather than cast, so a bare
        // test config and an older build's runtimeConfig both degrade to the
        // same default the resolver would produce.
        const moduleSpans = config.spans;
        this.spanEvents = spanEventsFromConfig(moduleSpans);

        if (this.consoleOutput) {
            this.consoleReporter = new ConsoleReporter();
        }

        this.consola = createConsola({
            level: this.level
        });

        this.consola.addReporter({
            log: async (logObj: LogObject) => {
                await this.handleLog(logObj);
            }
        });

        if (options.context) {
            this.globalContext.value = { ...options.context };
        }
    }


    /**
     * Which side of the module's `consoleOutput` option governs this logger.
     *
     * Deliberately not `import.meta.server`: ClientFrogger also runs during the
     * SSR render pass, and the logs it emits there belong to the client's flag.
     *
     * Called from the base constructor, so it resolves off the prototype and
     * must never touch subclass instance fields.
     */
    protected getConsoleScope(): 'client' | 'server' {
        return 'client';
    }


    // Trace Context Management ------------------------------------------
    public getHeaders(
        customVendor?: string
    ): Record<string, string> {
        const vendorData = customVendor
            ? { frogger: customVendor }
            : { frogger: generateSpanId() };

        const headers = generateW3CTraceHeaders({
            traceId: this.traceId,
            parentSpanId: this.outgoingSpanId(),
            vendorData,
            // Re-emit the decision we were given rather than a hardcoded '01':
            // fabricating `sampled` on every hop is how a deliberately
            // unsampled trace silently becomes sampled again downstream.
            flags: this.traceFlags,
            inboundTracestate: this.inboundTracestate,
        });

        return {
            traceparent: headers.traceparent,
            ...(headers.tracestate && { tracestate: headers.tracestate }),
            // Lets the server side of a request join to the same browser
            // session as the client rows that triggered it.
            ...(this.session ? { 'x-frogger-session': this.session.id } : {}),
        };
    }

    /**
     * The span id a downstream service should parent under: this logger's own,
     * always.
     *
     * No reservation, no "has it emitted yet" branch: because the id is stable
     * from construction, the id advertised in a header and the id on every row
     * this logger emits are the same value by construction. A request issued
     * before the first log and one issued after it now hang off the same node.
     */
    protected outgoingSpanId(): string {
        return this.spanId;
    }

    /**
     * This logger's own span identity. Read directly rather than recovered by
     * generating a traceparent and parsing it back: the round trip cost a
     * string build and a parse per exemplar, and silently dropped the sampling
     * decision on the floor.
     */
    public getSpanContext(): TraceContext {
        return {
            traceId: this.traceId,
            spanId: this.spanId,
            ...(this.parentSpanId ? { parentSpanId: this.parentSpanId } : {}),
            flags: this.traceFlags,
        };
    }

    /**
     * The trace context stamped on a row.
     *
     * Pure with respect to span identity: it reads `spanId`/`parentSpanId` and
     * mutates neither, so a row's position in the tree cannot depend on how
     * many rows preceded it.
     */
    protected generateTraceContext(suppliedTraceContext?: TraceContext): TraceContext {
        if (suppliedTraceContext) {
            if (suppliedTraceContext.traceId) {
                this.traceId = suppliedTraceContext.traceId;
            }
            if (suppliedTraceContext.parentSpanId) {
                this.parentSpanId = suppliedTraceContext.parentSpanId;
            }
            if (suppliedTraceContext.flags) {
                this.traceFlags = suppliedTraceContext.flags;
            }
        }

        const traceContext: TraceContext = {
            traceId: this.traceId,
            spanId: this.spanId,
            flags: this.traceFlags,
        };

        if (this.parentSpanId) {
            traceContext.parentSpanId = this.parentSpanId;
        }

        this.lastSpanId = this.spanId;

        return traceContext;
    }

    /**
     * Re-seed this logger onto another trace, parented under `parentSpanId`.
     * Used for the SSR -> CSR handoff and for server-side trace continuation.
     * The logger keeps its OWN span id: it is still one unit of work, it has
     * just been told where it sits.
     */
    protected setTraceContext(traceId: string, parentSpanId: string | null = null, flags?: string): void {
        this.traceId = traceId;
        this.parentSpanId = parentSpanId;
        this.lastSpanId = null;

        if (flags) {
            this.traceFlags = flags;
        }
    }


    // Reporter Management ------------------------------------------
    // The console reporter is deliberately NOT in `customReporters`: it is
    // Frogger's own output channel, not something the user registered. Keeping
    // it out means `getReporters()` cannot leak an internal object and
    // `clearReporters()` cannot silently kill console output as a side effect.
    public addReporter(reporter: IFroggerReporter): void {
        this.customReporters.push(reporter);
    }

    public removeReporter(reporter: IFroggerReporter): void {
        const index = this.customReporters.indexOf(reporter);
        if (index > -1) {
            this.customReporters.splice(index, 1);
        }
    }

    public clearReporters(): void {
        this.customReporters = [];
    }

    public getReporters(): readonly IFroggerReporter[] {
        return [...this.customReporters];
    }


    /**
     * Set (or clear) the acting user. Extra properties beyond `id` are ordinary
     * context: the id is an index key and is never scrubbed, whereas anything
     * else about the user is exactly what the scrubber is for.
     */
    public identify(user: string | { id: string, [key: string]: unknown } | null): void {
        if (user === null) {
            this.user = undefined;
            return;
        }

        if (typeof user === 'string') {
            this.user = user;
            return;
        }

        const { id, ...rest } = user;
        this.user = id;

        if (Object.keys(rest).length > 0) {
            this.addContext({ user: rest });
        }
    }

    /**
     * Annotate THIS span. Writes to the span's own bounded attribute bag, not
     * to the child logger's log context: a span attribute describes the unit of
     * work, whereas log context describes the rows inside it, and conflating
     * them is how a nested span's name overwrote its parent's.
     *
     * ```ts
     * const span = frogger.startSpan('checkout')
     * span.setAttribute('cart.items', items.length)
     * ```
     */
    public setAttribute(key: string, value: string | number | boolean): void {
        this.spanAttributes ??= {};
        this.spanAttributes[key] = value;
    }

    /** The route pattern rows from this logger belong to. Never a raw path. */
    public setRoute(route: string | undefined): void {
        this.route = route;
    }

    /** Attach this logger to a browser session. */
    public setSession(session: { id: string; sampled: boolean } | undefined): void {
        this.session = session;
    }

    /**
     * The correlation keys stamped on every row: top-level, never scrubbed.
     * Inherited from the parent when this logger has none of its own, so a
     * span child does not lose the request's identity.
     */
    protected correlationFields(): Pick<LoggerObject, 'session' | 'user' | 'route'> {
        return {
            ...(this.session ? { session: this.session } : {}),
            ...(this.user ? { user: this.user } : {}),
            ...(this.route ? { route: this.route } : {}),
        };
    }

    // Context Management -------------------------------------------
    public addContext(context: LogContext, options?: AddContextOptions): void {
        // Incoming wins by default (last-write-wins), so re-stamping a key like
        // `route` or `user` updates it instead of freezing on the first value.
        // `overwrite: false` flips precedence to fill only keys not already set.
        this.globalContext.value = options?.overwrite === false
            ? defu(this.globalContext.value, context)
            : defu(context, this.globalContext.value);
    }

    public setContext(context: LogContext): void {
        this.globalContext.value = context;
    }

    public clearContext(): void {
        this.globalContext.value = {};
    }


    // Child Logger Management --------------------------------------
    public abstract child(options: FroggerOptions): IFroggerLogger;

    public abstract reactiveChild(options: FroggerOptions): IFroggerLogger;

    // Implemented per-runtime: each concrete logger binds the span child to
    // its runtime's active-logger context (real ALS on the server, a
    // best-effort synchronous stack in the browser).
    public abstract span<T>(name: string, fn: () => T | Promise<T>): Promise<T>;

    public abstract startSpan(name: string, options?: FroggerOptions): IFroggerLogger;


    // Logging Methods ---------------------------------------------
    public logLevel(level: LogType, message: string, context?: Object): void {
        this.consola[level](message, context);
    }

    // 0 -----------------------------------------------------------
    public fatal(message: string, context?: Object): void {
        this.consola.fatal(message,
            context,
        )
    }

    public error(message: string, context?: Object): void {
        this.consola.error(message,
            context,
        )
    }


    // 1 ----------------------------------------------------
    public warn(message: string, context?: Object): void {
        this.consola.warn(message,
            context,
        )
    }


    // 2 ----------------------------------------------------
    public log(message: string, context?: Object): void {
        this.consola.log(message,
            context,
        )
    }


    // 3 ----------------------------------------------------
    public info(message: string, context?: Object): void {
        this.consola.info(message,
            context,
        );
    }

    public success(message: string, context?: Object): void {
        this.consola.success(message,
            context,
        )
    }

    public fail(message: string, context?: Object): void {
        this.consola.fail(message,
            context,
        )
    }

    public ready(message: string, context?: Object): void {
        this.consola.ready(message,
            context,
        )
    }

    public start(message: string, context?: Object): void {
        this.consola.start(message,
            context,
        )
    }

    // 4 ----------------------------------------------------
    public debug(message: string, context?: Object): void {
        this.consola.debug(message,
            context,
        )
    }

    // 5 ----------------------------------------------------
    public trace(message: string, context?: Object): void {
        this.consola.trace(message,
            context,
        )
    }

    // -999 -------------------------------------------------
    public silent(message: string, context?: Object): void {
        this.consola.silent(message,
            context,
        )
    }

    // +999 -------------------------------------------------
    public verbose(message: string, context?: Object): void {
        this.consola.verbose(message,
            context,
        )
    }


    /**
     * Record a business fact. See {@link IFroggerLogger.event}.
     *
     * Implemented as a normal `info` log carrying a marker in context, which
     * `createLoggerObject` lifts to the top-level `kind` field. Going through
     * the existing pipeline is the point: an event gets the same scrubbing,
     * batching and trace correlation as everything else for free.
     */
    public event(name: string, attributes?: Record<string, unknown>): void {
        this.consola.info(name, { ...attributes, [EVENT_MARKER]: true });
    }

    public reset(): void {
        this.globalContext.value = {};
        // Matches the documented contract. The console reporter is not a user
        // reporter and is intentionally kept.
        this.customReporters = [];

        this.traceId = generateTraceId();
        // A reset logger is a NEW unit of work on a new trace, so it gets a
        // fresh span identity rather than reusing the one it just abandoned.
        this.spanId = generateSpanId();
        this.parentSpanId = null;
        this.lastSpanId = null;
        this.traceFlags = '01';
        this.inboundTracestate = undefined;
    }


    // Server and client logger implement these different
    protected abstract createLoggerObject(logObj: LogObject): LoggerObject | Promise<LoggerObject>;

    protected abstract processLoggerObject(loggerObject: LoggerObject): void | Promise<void>;



    private async handleLog(logObj: LogObject): Promise<void> {
        try {
            const loggerObject = await this.createLoggerObject(logObj);

            if (this.scrubber) {
                await this.scrubber?.scrubLoggerObject(loggerObject);
            }

            await this.emitToReporters(loggerObject);

            await this.processLoggerObject(loggerObject);
        }
        catch (error) {
            // This is a lost customer log, not chatter: count it so
            // getFroggerHealth() can show that the pipeline is eating rows.
            recordPipelineError(error);
            froggerInternal.error('Error in log handling pipeline:', error);
        }
    }

    private async emitToReporters(loggerObject: LoggerObject): Promise<void> {
        if (this.consoleReporter) {
            try {
                await this.consoleReporter.log(loggerObject);
            }
            catch (error) {
                froggerInternal.error('Error in console reporter:', error);
            }
        }

        const reporterPromises = this.customReporters.map(async (reporter) => {
            try {
                await reporter.log(loggerObject);
            }
            catch (error) {
                froggerInternal.error('Error in custom reporter:', error);
            }
        });

        await Promise.all(reporterPromises);
    }

    /**
     * The span-end callback that records a `span.duration` histogram, or
     * `undefined` when nothing would consume it. Returning `undefined` matters:
     * it is what lets `runSpanWithEvent` skip its timer entirely on the default
     * path, so a span costs exactly what it did before.
     */
    protected spanMetricEnd(name: string, options?: SpanOptions): ((durationSeconds: number, ok: boolean, trace?: SpanExemplar) => void) | undefined {
        const enabled = options?.metric ?? (this.spanEvents ? this.spanEvents.metric : false);
        if (!enabled) return undefined;

        const sink = getSpanMetricSink();
        if (!sink) return undefined;

        return (durationSeconds: number, ok: boolean, trace?: SpanExemplar) =>
            sink(name, durationSeconds, ok, options?.labels, trace);
    }

    /**
     * The trace position a child logger (a `child()`, `span()` or
     * `startSpan()`) should take: same trace, parented under THIS logger's
     * stable span.
     *
     * Previously this snapshotted whatever row happened to have been emitted
     * last, so a child's parent edge depended on how many times the parent had
     * logged first - an order-dependent side effect in what is supposed to be
     * a structural relationship.
     */
    protected createChildTraceContext(): { traceId: string; parentSpanId: string; flags: string } {
        return {
            traceId: this.traceId,
            parentSpanId: this.spanId,
            // A child is part of the same trace, so it inherits the same
            // sampling decision rather than defaulting back to sampled.
            flags: this.traceFlags,
        };
    }

    /**
     * Copy this logger's correlation keys onto a freshly created child. A span
     * opened inside a request is the same user, session and route; without
     * this, every span would silently lose the request's identity.
     */
    protected inheritCorrelation(child: BaseFroggerLogger): void {
        child.user ??= this.user;
        child.route ??= this.route;
        child.session ??= this.session;
    }

    protected createChildContext(reactive: boolean = false): Ref<LogContext> | LogContext {
        if (reactive) {
            return this.mergedGlobalContext;
        }
        else {
            return { ...this.mergedGlobalContext.value };
        }
    }
}