import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import type { ServerLoggerOptions } from '../types/logger';
import type { LoggerObject } from '../../shared/types';

import { ServerLogQueueService } from '../services/server-log-queue';

import type { TraceContext } from '../../shared/types';

export class ServerFroggerLogger extends BaseFroggerLogger {
    private options: ServerLoggerOptions;
    private logQueue: ServerLogQueueService;

    private madeFirstLog: boolean = false;
    private traceContext: TraceContext | null = null;
    
    constructor(options: ServerLoggerOptions = {
        batch: true,
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            format: 'json'
        },
    }, traceContext: TraceContext | null = null) {
        super(options);
        this.options = options;

        this.logQueue = ServerLogQueueService.getInstance();
        
        if (options && (options.batch || options.file || options.endpoint)) {
            this.logQueue.initialize(options);
        }

        this.traceContext = traceContext;
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        if (!logObj || typeof logObj !== 'object') {
            console.warn('Invalid log object:', logObj);
            return;
        }

        let currentTraceContext: TraceContext | null = null;

        // This will only be called if the trace context is null, AND/OR its
        // the first log entry for this logger instance
        if (this.madeFirstLog || this.traceContext === null) {
            currentTraceContext = this.generateTraceContext();
        }
        else {
            currentTraceContext = this.generateTraceContext(this.traceContext);
        }

        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            level: logObj.level,
            date: logObj.date,
            trace: currentTraceContext,
            context: {
                env: 'server',
                message: logObj.args?.[0],
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            timestamp: Date.now()
        };
        
        this.logQueue.enqueueLog(froggerLoggerObject);

        if (!this.madeFirstLog) {
            this.madeFirstLog = true;
        }
    }

    /**
     * Log directly to file, bypassing the batch reporter
     * This is useful to prevent recursion in API handlers
     */
    public logToFile(logObjs: any): void {
        this.logQueue.logToFile(logObjs);
    }
    
    /**
     * Flush any pending logs
     */
    async flush(): Promise<void> {
        await this.logQueue.flush();
    }
}