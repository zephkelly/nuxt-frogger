import { type Ref, ref, computed } from "vue";
import { type ConsolaInstance, createConsola } from "consola/core";
import { generateTraceId, generateSpanId, generateW3CTraceHeaders } from "../shared/utils/trace-headers";

import type { LogType, LogObject } from 'consola';
import type { LoggerObject } from "../shared/types/log";
import type { IFroggerLogger, AddContextOptions } from "./types";
import type { FroggerOptions } from "../shared/types/options";
import type { LogContext } from "../shared/types/log";
import type { TraceContext } from "../shared/types/trace-headers";
import { ConsoleReporter } from "./_reporters/console-reporter";
import { froggerInternal } from "../shared/utils/internal-log";

import type { IFroggerReporter } from "./_reporters/types";
import { LogScrubber } from "../scrubber";
import type { ScrubberOptions } from "../scrubber/options";
import { spanEventsFromConfig, type ResolvedSpanEvents, type SpanOptions } from "../shared/utils/span-events";
import { getSpanMetricSink } from "../shared/utils/span-metric-sink";

import { useRuntimeConfig } from "#imports";
import { defu } from 'defu';



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
    protected lastSpanId: string | null = null;

    /**
     * The id this logger's NEXT row will use, minted early because
     * `getHeaders()` was called before that row existed. Consumed by
     * {@link generateTraceContext} so the id handed to a downstream service
     * turns into a real row rather than pointing at nothing.
     */
    protected reservedSpanId: string | null = null;

    /**
     * Whether this logger has emitted a row yet. `lastSpanId` cannot answer
     * this: a child is seeded with its PARENT's span id, so a non-null value
     * says nothing about whether this logger has logged.
     */
    protected hasEmitted: boolean = false;
    protected level: number;
    protected readonly consoleOutput: boolean;
    protected readonly scrub: boolean;
    protected readonly spanEvents: ResolvedSpanEvents;

    private customReporters: IFroggerReporter[] = [];
    private consoleReporter: ConsoleReporter | null = null;
    private scrubber: LogScrubber | null = null;


    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.level = options.level ?? 3;

        const config = useRuntimeConfig();

        const moduleConsoleOutput = (config.public?.frogger as {
            consoleOutput?: boolean | { client?: boolean; server?: boolean }
        } | undefined)?.consoleOutput;

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
        //@ts-ignore
        const moduleScrub = config.public.frogger.scrub as ScrubberOptions | false | undefined;
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
        const moduleSpans = (config.public?.frogger as { spans?: unknown } | undefined)?.spans;
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

        if (this.consoleReporter !== null) {
            this.addReporter(this.consoleReporter);
        }


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
            vendorData
        });

        return {
            traceparent: headers.traceparent,
            ...(headers.tracestate && { tracestate: headers.tracestate })
        };
    }

    /**
     * The span id a downstream service should parent under.
     *
     * Once this logger has emitted, that is the row it last emitted, which is
     * the documented "last log here is the parent of the first log there".
     *
     * Before it has emitted, `lastSpanId` still holds the PARENT's row, so
     * advertising it would make the downstream call a SIBLING of this span
     * instead of its child, which is what made a request issued at the top of a
     * span hang off the wrong node. Reserve the id this logger's first row will
     * use and advertise that instead; `generateTraceContext` consumes it, so
     * the id resolves to a real row as soon as anything is logged here.
     *
     * The reservation is stable: repeated calls before the first row return the
     * same id rather than minting a new one per outgoing request.
     */
    protected outgoingSpanId(): string {
        if (this.hasEmitted && this.lastSpanId) {
            return this.lastSpanId;
        }

        this.reservedSpanId ??= generateSpanId();
        return this.reservedSpanId;
    }

    protected generateTraceContext(suppliedTraceContext?: TraceContext): TraceContext {
        if (suppliedTraceContext) {
            if (suppliedTraceContext.traceId) {
                this.traceId = suppliedTraceContext.traceId;
            }
            if (suppliedTraceContext.parentId) {
                this.lastSpanId = suppliedTraceContext.parentId;
            }
        }

        // Consume any id `getHeaders()` already advertised, so the row that
        // arrives IS the one a downstream service was told to parent under.
        const newSpanId = this.reservedSpanId ?? generateSpanId();
        this.reservedSpanId = null;

        const traceContext: TraceContext = {
            traceId: this.traceId,
            spanId: newSpanId
        };

        if (this.lastSpanId) {
            traceContext.parentId = this.lastSpanId;
        }

        this.lastSpanId = newSpanId;
        this.hasEmitted = true;

        return traceContext;
    }

    protected setTraceContext(traceId: string, parentSpanId: string | null = null): void {
        this.traceId = traceId;
        this.lastSpanId = parentSpanId;

        // Re-seeding puts this logger at the start of a (possibly new) trace:
        // it has emitted nothing here, and any id it advertised belonged to the
        // trace it just left.
        this.reservedSpanId = null;
        this.hasEmitted = false;
    }


    // Reporter Management ------------------------------------------
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


    public reset(): void {
        this.globalContext.value = {};

        this.traceId = generateTraceId();
        this.lastSpanId = null;
        this.reservedSpanId = null;
        this.hasEmitted = false;
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
            froggerInternal.error('Error in log handling pipeline:', error);
        }
    }

    private async emitToReporters(loggerObject: LoggerObject): Promise<void> {
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
    protected spanMetricEnd(name: string, options?: SpanOptions): ((durationSeconds: number, ok: boolean) => void) | undefined {
        const enabled = options?.metric ?? (this.spanEvents ? this.spanEvents.metric : false);
        if (!enabled) return undefined;

        const sink = getSpanMetricSink();
        if (!sink) return undefined;

        return (durationSeconds: number, ok: boolean) => sink(name, durationSeconds, ok, options?.labels);
    }

    protected createChildTraceContext(): { traceId: string; parentSpanId: string | null } {
        return {
            traceId: this.traceId,
            parentSpanId: this.lastSpanId
        };
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