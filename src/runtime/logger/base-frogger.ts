import { type Ref, ref, computed } from "vue";
import { type ConsolaInstance, createConsola } from "consola/core";
import { generateTraceId, generateSpanId, generateW3CTraceHeaders } from "../shared/utils/trace-headers";

import type { LogType, LogObject } from 'consola';
import type { LoggerObject } from "../shared/types/log";
import type { IFroggerLogger } from "./types";
import type { FroggerOptions } from "../shared/types/options";
import type { LogContext } from "../shared/types/log";
import type { TraceContext } from "../shared/types/trace-headers";
import { ConsoleReporter } from "./_reporters/console-reporter";

import type { IFroggerReporter } from "./_reporters/types";
import { LogScrubber } from "../scrubber";

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
    protected level: number;
    protected readonly consoleOutput: boolean;
    protected readonly scrub: boolean;

    private customReporters: IFroggerReporter[] = [];
    private consoleReporter: ConsoleReporter | null = null;
    private scrubber: LogScrubber | null = null;


    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.level = options.level ?? 3;
        this.consoleOutput = options.consoleOutput !== false;
        this.scrub = options.scrub === true;

        const config = useRuntimeConfig();

        if (config.public.frogger.scrub || options.scrub) {
            this.scrubber = new LogScrubber(config.public.frogger.scrub);
        }

        if (options.consoleOutput !== false) {
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


    // Trace Context Management ------------------------------------------
    public getHeaders(
        customVendor?: string
    ): Record<string, string> {
        const vendorData = customVendor
            ? { frogger: customVendor }
            : { frogger: generateSpanId() };

        const headers = generateW3CTraceHeaders({
            traceId: this.traceId,
            parentSpanId: this.lastSpanId || undefined,
            vendorData
        });

        return {
            traceparent: headers.traceparent,
            ...(headers.tracestate && { tracestate: headers.tracestate })
        };
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

        const newSpanId = generateSpanId();

        const traceContext: TraceContext = {
            traceId: this.traceId,
            spanId: newSpanId
        };

        if (this.lastSpanId) {
            traceContext.parentId = this.lastSpanId;
        }

        this.lastSpanId = newSpanId;

        return traceContext;
    }

    protected setTraceContext(traceId: string, parentSpanId: string | null = null): void {
        this.traceId = traceId;
        this.lastSpanId = parentSpanId;
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
    public addContext(context: LogContext): void {
        this.globalContext.value = defu(this.globalContext.value, context);
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
            console.error('Error in log handling pipeline:', error);
        }
    }

    private async emitToReporters(loggerObject: LoggerObject): Promise<void> {
        const reporterPromises = this.customReporters.map(async (reporter) => {
            try {
                await reporter.log(loggerObject);
            }
            catch (error) {
                console.error('Error in custom reporter:', error);
            }
        });

        await Promise.all(reporterPromises);
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