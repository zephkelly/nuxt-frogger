import { type ConsolaInstance, createConsola } from "consola/core";
import type { FroggerLogger } from "../types/frogger";
import type { LogObject } from 'consola';
import type { FroggerOptions, LogContext, TraceContext } from "../types";

import { generateTraceId, generateSpanId } from "./tracing";
import { defu } from "defu";


export abstract class BaseFroggerLogger implements FroggerLogger {
    protected consola: ConsolaInstance;
    protected globalContext: LogContext = {};
    protected traceId: string;
    protected lastSpanId: string | null = null;
    protected level: number;
    
    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.level = options.level ?? 3;
        
        this.consola = createConsola({
            level: this.level
        });
        
        this.consola.addReporter({
            log: (logObj: LogObject) => {
                this.processLog(logObj);
            }
        });

        // Print to console
        // this.consola.addReporter({
        //     log: (logObj: LogObject) => {
        //         console.log(logObj);
        //     }
        // })
        
        if (options.context) {
            this.globalContext = { ...options.context };
        }
    }
    
    /**
     * Process a log entry - abstract method to be implemented by subclasses
     */
    protected abstract processLog(logObj: LogObject): void;

    protected generateTraceContext(): TraceContext {
        // Generate a new span ID for this log
        const newSpanId = generateSpanId();
        
        // Create the trace context
        const traceContext: TraceContext = {
            traceId: this.traceId,
            spanId: newSpanId
        };
        
        // If we have a previous span ID, use it as the parent
        if (this.lastSpanId) {
            traceContext.parentId = this.lastSpanId;
        }
        
        // Update the last span ID for future logs
        this.lastSpanId = newSpanId;
        
        return traceContext;
    }
    

    trace(message: string, context?: Object): void {
        this.consola.trace(message,
            context,
        )
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
    
    /**
     * Context management methods
     */
    addGlobalContext(context: LogContext): void {
        this.globalContext = defu(this.globalContext, context);
    }
    
    setUser(userId: string): void {
        this.globalContext.userId = userId;
    }
    
    setSession(sessionId: string): void {
        this.globalContext.sessionId = sessionId;
    }
    
    /**
     * Log level management
     */
    getLevel(): number {
        return this.level;
    }
    
    setLevel(level: number): void {
        this.level = level;
        this.consola.level = level;
    }
}