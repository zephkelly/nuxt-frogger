import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import type { ServerLoggerOptions } from '../types/logger';
import type { LoggerObject } from '../../shared/types/log';

import { ServerLogQueueService } from '../services/server-log-queue';

import type { TraceContext } from '../../shared/types/trace';



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

        if (this.madeFirstLog || this.traceContext === null) {
            currentTraceContext = this.generateTraceContext();
        }
        // This will only be called once on first initialisation so long as a
        // trace context is provided. This is used to link traces from the client
        // to the server.
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
     * Flush any pending logs
     */
    async flush(): Promise<void> {
        await this.logQueue.flush();
    }
}