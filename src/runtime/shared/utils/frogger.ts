import { type ConsolaInstance, createConsola } from "consola";
import type { Frogger } from "../types/frogger";
import type { LogObject } from 'consola';
import type { FroggerOptions, LogContext, TraceContext } from "../types";

import { generateTraceId, generateSpanId } from "../utils/tracing";



export abstract class BaseFrogger implements Frogger {
    protected consola: ConsolaInstance;
    protected context: LogContext = {};
    protected traceId: string;
    protected spanId: string;
    protected level: number;
    
    constructor(options: FroggerOptions = {}) {
        this.traceId = generateTraceId();
        this.spanId = generateSpanId();
        this.level = options.level ?? 3;
        
        this.consola = createConsola({
            level: this.level,
            reporters: [
                {
                    log: (logObj: LogObject) => {
                        this.processLog(logObj);
                    }
                }
            ]
        });
        
        if (options.context) {
            this.context = { ...options.context };
        }
    }
    
    /**
     * Process a log entry - abstract method to be implemented by subclasses
     */
    protected abstract processLog(logObj: LogObject): void;
    

    fatal(message: any, ...args: any[]): void {
        this.consola.fatal(message, ...args);
    }
    
    error(message: any, ...args: any[]): void {
        this.consola.error(message, ...args);
    }
    
    warn(message: any, ...args: any[]): void {
        this.consola.warn(message, ...args);
    }
    
    info(message: any, ...args: any[]): void {
        this.consola.info(message, ...args);
    }
    
    debug(message: any, ...args: any[]): void {
        this.consola.debug(message, ...args);
    }
    
    trace(message: any, ...args: any[]): void {
        this.consola.trace(message, ...args);
    }
    
    /**
     * Context management methods
     */
    addContext(context: LogContext): void {
        this.context = {
            ...this.context,
            ...context
        };
    }
    
    setUser(userId: string): void {
        this.context.userId = userId;
    }
    
    setSession(sessionId: string): void {
        this.context.sessionId = sessionId;
    }
    
    /**
     * Create a child span for tracing
     */
    startSpan(name: string, attributes?: Record<string, any>): {
        end: () => void;
        context: TraceContext;
    } {
        const parentId = this.spanId;
        const spanId = generateSpanId();
        
        this.debug(`[SPAN START] ${name}`, { attributes });
        
        return {
            context: {
                traceId: this.traceId,
                spanId,
                parentId
            },
            end: () => {
                this.debug(`[SPAN END] ${name}`, { 
                    // duration: Date.now() - Date.now(),
                    attributes 
                });
            }
        };
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