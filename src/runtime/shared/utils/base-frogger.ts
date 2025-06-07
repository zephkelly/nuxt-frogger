import { type Ref, ref } from "vue";
import { type ConsolaInstance, createConsola } from "consola/core";
import { generateTraceId, generateSpanId, generateW3CTraceHeaders } from "./trace-headers";

import type { LogObject } from 'consola';
import type { LoggerObject } from "../types/log";
import type { IFroggerLogger } from "../types/frogger";
import type { FroggerOptions } from "../types/options";
import type { LogContext } from "../types/log";
import type { TraceContext } from "../types/trace-headers";
import { ConsoleReporter } from "./reporters/console-reporter";

import type { IFroggerReporter } from "../types/frogger-reporter";
import { LogScrubber } from "../../scrubber";



export abstract class BaseFroggerLogger implements IFroggerLogger {
    protected consola: ConsolaInstance;
    protected globalContext: Ref<LogContext> = ref({});
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
        this.scrub = options.scrub !== false;

        //@ts-expect-error
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

        if (this.consoleReporter !== undefined) {
            this.consola.addReporter({
                log: (logObj: LogObject) => {
                    try {
                        this.consoleReporter?.log(logObj);
                    }
                    catch (err) {
                        console.log(`[${logObj.type.toUpperCase()}]`, logObj.args?.[0] || '', ...logObj.args?.slice(1) || []);
                    }
                }
            });
        }

        
        if (options.context) {
            this.globalContext.value = { ...options.context };
        }
    }

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

    protected abstract createLoggerObject(logObj: LogObject): LoggerObject | Promise<LoggerObject>;

    protected abstract processLoggerObject(loggerObject: LoggerObject): void | Promise<void>;


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
 
    /**
     * Set the trace ID and last span ID for this logger
     * (Used internally for SSR-CSR continuity)
     */
    protected setTraceContext(traceId: string, parentSpanId: string | null = null): void {
        this.traceId = traceId;
        this.lastSpanId = parentSpanId;
    }

    /**
     * Get W3C Trace Context headers for the current logger instance
     * For use with HTTP requests. add to the request headers of $fetch or useFetch:
     *  
     * ```ts
     * const logger = useFrogger();
     * ```
     * 
     * With $fetch...
     * ```ts
     * const respose = await $fetch('/api/endpoint', {
     *   method: 'POST',
     *   headers: logger.getHeaders()
     * });
     * ```
     * With useFetch...
     * ```ts
     * const { data, error } = await useFetch('/api/endpoint', {
     *   method: 'POST',
     *   headers: logger.getHeaders()
     * });
     * ```
     * 
     * Or, use the spread operator to add additional
     * ```ts
     * const { data, error } = await useFetch('/api/endpoint', {
     *  method: 'POST',
     *  headers: {
     *    ...logger.getHeaders(),
     *   'X-My-Custom-Header': 'value'
     *   }
     * });
     * ```
     */
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


    // 0 ----------------------------------------------------
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
}