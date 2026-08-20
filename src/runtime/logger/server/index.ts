import type { LogObject } from 'consola/basic';

import { BaseFroggerLogger } from '../base-frogger';
import type { ServerLoggerOptions } from '../../server/types/logger';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import { ServerLogQueueService } from '../../server/services/server-log-queue';
import { parseAppInfoConfig } from '../../app-info/parse';

import type { TraceContext } from '../../shared/types/trace-headers';

import { defu } from 'defu';
import { useRuntimeConfig } from '#imports';
import { froggerInternal } from '../../shared/utils/internal-log';
import { normalizeContextErrors } from '../../shared/utils/normalize-errors';
import { runSpanWithEvent } from '../../shared/utils/span-events';
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

        //@ts-ignore
        const config = useRuntimeConfig();
        //@ts-ignore
        const { isSet, name, version } = parseAppInfoConfig(config?.public?.frogger?.app);

        this.appInfo = isSet ? { 
            name: name,
            version: version
        } : undefined;

        this.logQueue = ServerLogQueueService.getInstance();
        this.traceContext = traceContext;
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
            time: logObj.date.getTime(),
            lvl: logObj.level,
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
        };

        return loggerObject;
    }
    
    protected processLoggerObject(loggerObject: LoggerObject): void {
        this.logQueue.enqueueLog(loggerObject);
       
        if (!this.madeFirstLog) {
            this.madeFirstLog = true;
        }
    }
    
    async flush(): Promise<void> {
        await this.logQueue.flush();
    }


    private createChild(options: ServerLoggerOptions, reactive: boolean): ServerFroggerLogger {
        const { traceId, parentSpanId } = this.createChildTraceContext();
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

        const childTraceContext: TraceContext = {
            traceId: traceId,
            parentId: parentSpanId || undefined,
            spanId: parentSpanId  as string
        };

        const child = new ServerFroggerLogger(childOptions, childTraceContext);

        // Mirror ClientFrogger: seed the child's live trace immediately so a
        // grandchild created before the child's first log (e.g. a nested span
        // opened right away) stays on the same trace instead of branching
        // onto the child's fresh random trace ID.
        child.setTraceContext(traceId, parentSpanId);

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

    public span<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
        const child = this.startSpan(name);
        return runSpanWithEvent(child, name, this.spanEvents, () => runWithLogger(child, fn));
    }
}