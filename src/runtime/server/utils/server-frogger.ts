import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import { BatchReporter } from './reporters/batch-reporter';
import { FileReporter } from './reporters/file-reporter';
import type { ServerLoggerOptions } from '../types/logger';
import { generateSpanId } from '../../shared/utils/tracing';



export class ServerFroggerLogger extends BaseFroggerLogger {
    private batchReporter?: BatchReporter;
    private fileReporter?: FileReporter;
    private options: ServerLoggerOptions;
    
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
                    if (!logs || !logs.length) return;
                    
                    try {
                        if (this.fileReporter) {
                            for (const log of logs) {
                                try {
                                    this.fileReporter.log(log);
                                } catch (err) {
                                    console.error('Error writing log to file:', err);
                                }
                            }
                        }
                        
                        const enrichedLogs = logs.map(log => ({
                            ...log,
                            context: {
                                ...this.context,
                                processed: true,  // Flag that this has been processed
                            }
                        }));
                        
                        // Send the processed batch to endpoint
                        await $fetch(options.endpoint || '/api/_frogger/logs', {
                            method: 'POST',
                            body: {
                                logs: enrichedLogs,
                                app: {
                                    name: 'nuxt-server',
                                    version: process.env.npm_package_version || 'unknown'
                                },
                                context: {
                                    processed: true
                                }
                            },
                        });
                    }
                    catch (error) {
                        console.error('Failed to send logs:', error);
                       
                        if (this.batchReporter && batchOptions.retryOnFailure) {
                            console.debug('Retry on failure enabled, will retry later');
                        }
                    }
                }
            });
        }
    }
    
    /**
     * Process a log entry from Consola
     */
    protected processLog(logObj: LogObject): void {
        const enrichedLog = {
            type: logObj.type,
            date: logObj.date,
            trace: {
                traceId: this.traceId,
                spanId: generateSpanId()
            },
            context: {
                ...this.context,
                ...logObj.args?.slice(1)[0],
                message: logObj.args?.[0] || logObj.message,
            },
            timestamp: Date.now()
        };

        if (this.fileReporter) {
            try {
                if (enrichedLog && typeof enrichedLog === 'object' && 
                    'logs' in enrichedLog && Array.isArray(enrichedLog.logs)) {
                    
                    for (const individualLog of enrichedLog.logs) {
                        const logWithMetadata = {
                            ...individualLog,
                        };
                        this.fileReporter.log(logWithMetadata);
                    }
                } else {
                    // This is a single log

                    //@ts-expect-error
                    this.fileReporter.log(enrichedLog);
                }
            } catch (err) {
                console.error('Error in file reporter:', err);
            }
        }
        
        if (this.batchReporter && 
            !(enrichedLog.context && 
              typeof enrichedLog.context === 'object')) {
            try {

                //@ts-expect-error
                this.batchReporter.log(enrichedLog);
            } catch (err) {
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
                const enrichedLog = {
                    ...logObj,
                    context: {
                        ...this.context,
                        processed: true
                    }
                };
                
                if (enrichedLog && typeof enrichedLog === 'object' && 
                    'logs' in enrichedLog && Array.isArray(enrichedLog.logs)) {
                    
                    for (const individualLog of enrichedLog.logs) {
                        const logWithMetadata = {
                            ...individualLog,
                            context: {
                                ...individualLog.context,
                                processed: true
                            }
                        };
                        this.fileReporter.log(logWithMetadata);
                    }
                } else {
                    this.fileReporter.log(enrichedLog);
                }
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