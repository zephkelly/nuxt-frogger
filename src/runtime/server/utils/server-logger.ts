import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import type { ServerLoggerOptions } from '../types/logger';
import type { LoggerObject } from '../../shared/types/log';
import { ServerLogQueueService } from '../services/server-log-queue';

import type { TraceContext } from '../../shared/types/trace-headers';



export class ServerFroggerLogger extends BaseFroggerLogger {
    private options: ServerLoggerOptions;
    private logQueue: ServerLogQueueService;
    private madeFirstLog: boolean = false;
    private traceContext: TraceContext | null = null;
    
    // Test-only callback for capturing LoggerObjects
    private testCaptureCallback: ((loggerObject: LoggerObject) => void) | null = null;
   
   
    constructor(options: ServerLoggerOptions, traceContext: TraceContext | null = null) {
        super(options);
        this.options = options;
        this.logQueue = ServerLogQueueService.getInstance();
        this.traceContext = traceContext;
    }

    /**
     * Test-only method to set a capture callback
     * This will be called with every LoggerObject that gets created
     */
    setTestCaptureCallback(callback: (loggerObject: LoggerObject) => void | null): void {
        this.testCaptureCallback = callback;
    }

    /**
     * Test-only method to clear the capture callback
     */
    clearTestCaptureCallback(): void {
        this.testCaptureCallback = null;
    }

    /**
     * Test-only method to directly create a LoggerObject without processing
     * This bypasses the queue system for benchmarking
     */
    createLoggerObjectForTest(message: string, context?: any, level: string = 'info', logLevel: number = 3): LoggerObject {
        const mockLogObject: LogObject = {
            date: new Date(),
            level: logLevel,
            //@ts-ignore
            type: level,
            args: context ? [message, context] : [message]
        };

        return this.createLoggerObject(mockLogObject);
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
                env: 'server',
                type: logObj.type,
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            trace: currentTraceContext,
        };

        // Call test capture callback if set
        if (this.testCaptureCallback) {
            this.testCaptureCallback(loggerObject);
        }

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