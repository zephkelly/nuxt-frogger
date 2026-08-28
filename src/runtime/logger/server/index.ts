import type { LogObject } from 'consola/basic';

import { BaseFroggerLogger } from '../base-frogger';
import type { ServerLoggerOptions } from '../../server/types/logger';
import { SCRUB_HANDLED, levelOf, severityOf } from '../../shared/types/log';
import { eventKind } from '../../shared/utils/event-kind';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import { ServerLogQueueService } from '../../server/services/server-log-queue';
import { parseAppInfoConfig } from '../../app-info/parse';
import { uuidv7 } from '../../shared/utils/uuid';

import type { TraceContext } from '../../shared/types/trace-headers';

import { defu } from 'defu';
import { useFroggerConfig } from '../../shared/utils/use-frogger-config';
import { froggerInternal } from '../../shared/utils/internal-log';
import { normalizeContextErrors } from '../../shared/utils/normalize-errors';
import { runSpanWithEvent, type SpanOptions } from '../../shared/utils/span-events';
import { runWithLogger } from '../active-context.server';
import type { FroggerOptions } from '../../shared/types/options';
import type { IFroggerLogger } from '../types';

export class ServerFroggerLogger extends BaseFroggerLogger {
    private options: ServerLoggerOptions;
    private logQueue: ServerLogQueueService;
    private madeFirstLog: boolean = false;
    private traceContext: TraceContext | null = null;
    
    constructor(options: ServerLoggerOptions, traceContext: TraceContext | null = null) {
        super(options);
        this.options = options;

        const { isSet, name, version } = parseAppInfoConfig(useFroggerConfig().app);

        this.appInfo = isSet ? { 
            name: name,
            version: version
        } : undefined;

        this.logQueue = ServerLogQueueService.getInstance();
        this.traceContext = traceContext;

        // Adopt the inbound decision immediately: a request that logs nothing
        // itself but issues an outbound call must still propagate the flags it
        // was given, and `getHeaders()` can run before the first row exists.
        if (traceContext?.flags) {
            this.traceFlags = traceContext.flags;
        }
    }

    protected override getConsoleScope(): 'client' | 'server' {
        return 'server';
    }

    protected createLoggerObject(logObj: LogObject): LoggerObject {
        if (!logObj || typeof logObj !== 'object') {
            froggerInternal.warn('Invalid log object:', logObj);
            throw new Error('Invalid log object provided');
        }
        
        let currentTraceContext: TraceContext | null = null;
        if (this.madeFirstLog || this.traceContext === null) {
            currentTraceContext = this.generateTraceContext();
        }
        else {
            // This will only be called once on first initialisation so long as a
            // trace context is provided. This is used to link traces from the client
            // to the server.
            currentTraceContext = this.generateTraceContext(this.traceContext);
        }
        
        const loggerObject: LoggerObject = {
            id: uuidv7(),
            time: logObj.date.getTime(),
            // Derived from `type`, never copied off consola's LogObject: consola
            // uses ±Infinity for silent/verbose, which JSON-serialise to null.
            lvl: levelOf(logObj.type),
            sev: severityOf(logObj.type),
            type: logObj.type,
            msg: logObj.args?.[0],
            // Errors in ctx are flattened to JSON-safe objects here, or their
            // non-enumerable name/message/stack vanish at the transport.
            ctx: normalizeContextErrors({
                ...this.mergedGlobalContext.value,
                ...this.globalContext.value,
                ...logObj.args?.slice(1)[0],
            }),
            env: 'server',
            source: this.appInfo !== undefined ? {
                name: this.appInfo.name || 'unknown',
                version: this.appInfo?.version || 'unknown',
            } : undefined,
            trace: currentTraceContext,
            ...this.correlationFields(),
            ...eventKind(logObj.args?.slice(1)[0]),
        };

        return loggerObject;
    }
    
    protected processLoggerObject(loggerObject: LoggerObject): void {
        // handleLog already applied this logger's scrub disposition (its rules
        // or an explicit `scrub: false`); the stamp stops the queue's
        // module-level pass from overriding it.
        loggerObject[SCRUB_HANDLED] = true;
        this.logQueue.enqueueLog(loggerObject);
       
        if (!this.madeFirstLog) {
            this.madeFirstLog = true;
        }
    }
    
    async flush(): Promise<void> {
        await this.logQueue.flush();
    }


    private createChild(options: ServerLoggerOptions, reactive: boolean): ServerFroggerLogger {
        const { traceId, parentSpanId, flags } = this.createChildTraceContext();
        const childContext = this.createChildContext(reactive);

        const childOptions: ServerLoggerOptions = {
            // Child options win; the parent's act as defaults.
            ...defu(options, this.options),
            // scrub must replace wholesale, not deep-merge: defu would
            // concatenate the two configs' rule arrays, silently re-adding
            // parent rules a child scrub object was meant to replace.
            ...(options.scrub !== undefined && { scrub: options.scrub }),
            context: reactive
                ? options.context
                // Explicit child context overrides inherited keys (a nested
                // startSpan must be able to replace the parent's `span`).
                : (defu(options.context, childContext) as LogContext),
        };

        // The child is a NEW span parented under this logger's stable span.
        // `spanId` is left to the child's own constructor: seeding it with the
        // parent's id is what made a child indistinguishable from its parent.
        const childTraceContext: TraceContext = {
            traceId: traceId,
            parentSpanId: parentSpanId,
            spanId: '',
            flags,
        };

        const child = new ServerFroggerLogger(childOptions, childTraceContext);

        // Mirror ClientFrogger: seed the child's live trace immediately so a
        // grandchild created before the child's first log (e.g. a nested span
        // opened right away) stays on the same trace instead of branching
        // onto the child's fresh random trace ID.
        child.setTraceContext(traceId, parentSpanId, flags);
        this.inheritCorrelation(child);

        if (reactive) {
            child.parentGlobalContext = this.globalContext;
        }

        return child;
    }

    /**
     * Create a child logger that shares the same trace ID
     * @param options - Logger options for the child logger
     */
    public child(options: ServerLoggerOptions): ServerFroggerLogger {
        return this.createChild(options, false);
    }

    public reactiveChild(options: ServerLoggerOptions): ServerFroggerLogger {
        return this.createChild(options, true);
    }

    public startSpan(name: string, options: FroggerOptions = {}): IFroggerLogger {
        return this.child(defu({ context: { span: name } }, options));
    }

    public span<T>(name: string, fn: () => T | Promise<T>, options?: SpanOptions): Promise<T> {
        const child = this.startSpan(name);
        return runSpanWithEvent(child, name, this.spanEvents, () => runWithLogger(child, fn), this.spanMetricEnd(name, options), options);
    }
}