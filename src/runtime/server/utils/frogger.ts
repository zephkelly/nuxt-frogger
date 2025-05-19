import type { LogObject } from 'consola/basic';
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
            console.info('File reporter initialised');
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
                    try {
                        await $fetch(options.endpoint || '/api/_frogger/logs', {
                            method: 'POST',
                            body: logs,
                        })
                    }
                    catch (error) {
                        console.error('Failed to send logs:', error);
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
        
        if (this.fileReporter) {
            try {
                this.fileReporter.log(logObj);
            }
            catch (err) {
                console.error('Error in file reporter:', err);
            }
        }
        
        if (this.batchReporter) {
            try {
                this.batchReporter.log(enrichedLog);
            }
            catch (err) {
                console.error('Error in batch reporter:', err);
            }
        }
    }

    /**
     * Log directly to file, bypassing the batch reporter
     * This is useful to prevent recursion in API handlers
     */
    public logToFile(logObj: LogObject): void {
        if (this.fileReporter) {
            try {
                // Add marker to avoid double processing
                const enrichedLog = {
                    ...logObj,
                    context: {
                        ...this.context,
                        fileOnly: true,
                        processed: true
                    }
                };
                this.fileReporter.log(enrichedLog);
            } catch (err) {
                console.error('Error writing directly to file:', err);
            }
        } else {
            console.warn('File reporter not configured, cannot log directly to file');
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

        if (this.fileReporter && typeof this.fileReporter.flush === 'function') {
            promises.push(this.fileReporter.flush());
        }
        
        await Promise.all(promises);
    }
}