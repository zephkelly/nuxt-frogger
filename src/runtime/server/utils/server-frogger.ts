import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import type { ServerLoggerOptions } from '../types/logger';
import type { LoggerObject } from '../../shared/types';

import { ServerLogQueueService } from '../services/server-log-queue';



export class ServerFroggerLogger extends BaseFroggerLogger {
    private options: ServerLoggerOptions;
    private logQueue: ServerLogQueueService;
    
    constructor(options: ServerLoggerOptions = {
        batch: true,
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            format: 'json'
        },
    }) {
        super(options);
        this.options = options;

        // Get the singleton instance
        this.logQueue = ServerLogQueueService.getInstance();
        
        // Initialize the queue service if options are provided
        // This will only take effect if not already initialized
        if (options && (options.batch || options.file || options.endpoint)) {
            this.logQueue.initialize(options);
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        if (!logObj || typeof logObj !== 'object') {
            console.warn('Invalid log object:', logObj);
            return;
        }

        const traceContext = this.generateTraceContext();

        const froggerLoggerObject: LoggerObject = {
            type: logObj.type,
            level: logObj.level,
            date: logObj.date,
            trace: traceContext,
            context: {
                env: 'server',
                message: logObj.args?.[0],
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            timestamp: Date.now()
        };
        
        // Use the shared log queue service
        this.logQueue.enqueueLog(froggerLoggerObject);
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