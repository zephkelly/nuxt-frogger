import type { LogObject, LogType } from 'consola/basic';



import { BaseFroggerLogger } from '../base-frogger';
import type { ServerLoggerOptions } from '../../server/types/logger';
import type { LoggerObject } from '../../shared/types/log';
import { ServerLogQueueService } from '../../server/services/server-log-queue';

import type { TraceContext } from '../../shared/types/trace-headers';



export class ServerFroggerLogger extends BaseFroggerLogger {
    private options: ServerLoggerOptions;
    private logQueue: ServerLogQueueService;
    private madeFirstLog: boolean = false;
    private traceContext: TraceContext | null = null;
    
    constructor(options: ServerLoggerOptions, traceContext: TraceContext | null = null) {
        super(options);
        this.options = options;
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
            msg: logObj.args?.[0],
            ctx: {
                ...this.globalContext.value,
                ...logObj.args?.slice(1)[0],
            },
            env: 'server',
            type: logObj.type,
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
}