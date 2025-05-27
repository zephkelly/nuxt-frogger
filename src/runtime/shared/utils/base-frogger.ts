import { type ConsolaInstance, createConsola } from "consola/core";
import { generateTraceId, generateSpanId } from "./tracing";

import type { LogObject } from 'consola';
import type { FroggerLogger } from "../types/frogger";
import type { FroggerOptions } from "../types/options";
import type { LogContext } from "../types/log";
import type { TraceContext } from "../types/trace";
import { ConsoleReporter } from "./reporters/console-reporter";


export abstract class BaseFroggerLogger implements FroggerLogger {
    protected consola: ConsolaInstance;
    protected globalContext: LogContext = {};
    protected traceId: string;
    protected lastSpanId: string | null = null;
    protected level: number;

    private consoleReporter: ConsoleReporter | undefined;
    
    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.level = options.level ?? 3;

        if (options.consoleOutput !== false) {
            this.consoleReporter = new ConsoleReporter();
        }
        
        this.consola = createConsola({
            level: this.level
        });
        
        this.consola.addReporter({
            log: (logObj: LogObject) => {
                this.processLog(logObj);
            }
        });

        if (this.consoleReporter !== undefined) {
            this.consola.addReporter({
                log: (logObj: LogObject) => {
                    try {
                        this.consoleReporter?.log(logObj);
                    } catch (err) {
                        console.log(`[${logObj.type.toUpperCase()}]`, logObj.args?.[0] || '', ...logObj.args?.slice(1) || []);
                    }
                }
            });
        }

        
        if (options.context) {
            this.globalContext = { ...options.context };
        }
    }
    
    /**
     * Process a log entry - abstract method to be implemented by subclasses
     */
    protected abstract processLog(logObj: LogObject): void;

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
    public getHeaders(customVendor?: string): Record<string, string> {
        // Create a new trace context with a fresh span ID
        const currentSpan = this.lastSpanId

        // Dont update the span, so that any subsequent logs
        // on the client use the initial request span ID as
        // the parent
        const newSpanId = generateSpanId();
        
        // Format: 00-{traceId}-{spanId}-01 (version-traceId-spanId-flags)
        // Where flags 01 means "sampled" (trace is being recorded)
        const traceparent = `00-${this.traceId}-${currentSpan}-01`;
        
        // Vendor-specific trace information
        const tracestate = `frogger=${customVendor || newSpanId}`;

        return {
            traceparent,
            tracestate
        };
    }

    /**
     * Set the trace ID and last span ID for this logger
     * (Used internally for SSR-CSR continuity)
     */
    protected setTraceContext(traceId: string, parentSpanId: string | null = null): void {
        this.traceId = traceId;
        this.lastSpanId = parentSpanId;
    }
    
    success(message: string, context?: Object): void {
        this.consola.success(message,
            context,
        )
    }
    
    debug(message: string, context?: Object): void {
        this.consola.debug(message,
            context,
        )
    }

    log(message: string, context?: Object): void {
        this.consola.log(message,
            context,
        )
    }
    
    info(message: string, context?: Object): void {
        this.consola.info(message,
            context,
        );
    }
    
    warn(message: string, context?: Object): void {
        this.consola.warn(message,
            context,
        )
    }

    fatal(message: string, context?: Object): void {
        this.consola.fatal(message,
            context,
        )
    }
    
    error(message: string, context?: Object): void {
        this.consola.error(message,
            context,
        )
    }
}