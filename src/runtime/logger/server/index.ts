import type { LogObject } from 'consola/basic';

import { BaseFroggerLogger } from '../base-frogger';
import type { ServerLoggerOptions } from '../../server/types/logger';
import type { LoggerObject, LogContext } from '../../shared/types/log';
import { ServerLogQueueService } from '../../server/services/server-log-queue';
import { parseAppInfoConfig } from '../../app-info/parse';

import type { TraceContext } from '../../shared/types/trace-headers';

import { defu } from 'defu';

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

    protected createLoggerObject(logObj: LogObject): LoggerObject {
        if (!logObj || typeof logObj !== 'object') {
            console.warn('Invalid log object:', logObj);
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
            ctx: {
                ...this.mergedGlobalContext.value,
                ...this.globalContext.value,
                ...logObj.args?.slice(1)[0],
            },
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
            ...defu(this.options, options),
            context: reactive 
                ? options.context
                : (defu(childContext, options.context) as LogContext),
        };

        const childTraceContext: TraceContext = {
            traceId: traceId,
            parentId: parentSpanId || undefined,
            spanId: parentSpanId  as string
        };

        const child = new ServerFroggerLogger(childOptions, childTraceContext);

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
}