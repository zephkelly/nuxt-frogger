import type { LogObject } from 'consola';
import { BaseFrogger } from '../../shared/utils/frogger';
import { BatchReporter } from './reporters/batch-reporter';
import { FileReporter } from './reporters/file-reporter';
import type { ServerLoggerOptions } from '../types/logger';



export class ServerFrogger extends BaseFrogger {
    private batchReporter?: BatchReporter;
    private fileReporter?: FileReporter;
    private options: ServerLoggerOptions;
    
    constructor(options: ServerLoggerOptions = {}) {
        super(options);
        this.options = options;
        
        // Set up file reporter if enabled
        if (options.file) {
            const fileOptions = typeof options.file === 'object' ? options.file : {};
            this.fileReporter = new FileReporter({
                directory: fileOptions.directory,
                fileNameFormat: fileOptions.fileNameFormat,
                maxSize: fileOptions.maxSize,
                format: fileOptions.format,
                additionalFields: options.additionalFields
            });
        }
        
        // Set up batch reporter if enabled
        if (options.batch && options.endpoint) {
            const batchOptions = typeof options.batch === 'object' ? options.batch : {};
            
            this.batchReporter = new BatchReporter({
                maxSize: batchOptions.maxSize,
                maxAge: batchOptions.maxAge,
                retryOnFailure: batchOptions.retryOnFailure,
                maxRetries: batchOptions.maxRetries,
                retryDelay: batchOptions.retryDelay,
                additionalFields: options.additionalFields,
                onFlush: async (logs) => {
                    // Send logs to configured endpoint
                    const response = await fetch(options.endpoint!, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ logs })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                    }
                }
            });
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        // Enrich log with trace context and additional context
        const enrichedLog = {
            ...logObj,
            trace: {
                traceId: this.traceId,
                spanId: this.spanId
            },
            context: this.context,
            timestamp: logObj.date ?? Date.now()
        };
        
        // Send to batch reporter if configured
        if (this.batchReporter) {
            this.batchReporter.log(enrichedLog);
        }
        
        // Send to file reporter if configured
        if (this.fileReporter) {
            this.fileReporter.log(enrichedLog);
        }
    }
    
    /**
     * Flush any pending logs
     */
    async flush(): Promise<void> {
        const promises: Promise<void>[] = [];
        
        if (this.batchReporter) {
            promises.push(this.batchReporter.forceFlush());
        }
        
        await Promise.all(promises);
    }
}