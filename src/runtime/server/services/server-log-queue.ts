import { BatchReporter } from '../utils/reporters/batch-reporter'
import { FileReporter } from '../utils/reporters/file-reporter'
import type { LoggerObject } from '../../shared/types'
import type { ServerLoggerOptions } from '../types/logger'



/**
 * Centralized server-side log queue service
 * Implements the Singleton pattern
 */
export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;
    private batchReporter?: BatchReporter
    private fileReporter?: FileReporter
    private initialized: boolean = false
    private defaultOptions: ServerLoggerOptions = {
        batch: true,
        file: {
            directory: 'logs',
            fileNameFormat: 'YYYY-MM-DD.log',
            maxSize: 10 * 1024 * 1024,
            format: 'json'
        }
    }

    /**
     * Private constructor to prevent direct instantiation
     */
    private constructor() { }

    /**
     * Get the singleton instance
     */
    public static getInstance(): ServerLogQueueService {
        if (!ServerLogQueueService.instance) {
        ServerLogQueueService.instance = new ServerLogQueueService();
        }
        return ServerLogQueueService.instance;
    }

    /**
     * Initialize the queue service with options
     */
    public initialize(options: ServerLoggerOptions = this.defaultOptions): void {
        if (this.initialized) {
            return
        }

        this.initialized = true

        // Set up file reporter if enabled
        if (options.file) {
        const fileOptions = typeof options.file === 'object' ? options.file : {}
        this.fileReporter = new FileReporter({
            directory: fileOptions.directory,
            fileNameFormat: fileOptions.fileNameFormat,
            maxSize: fileOptions.maxSize,
            additionalFields: options.additionalFields
        })
        }
        
        // Set up batch reporter if enabled
        if (options.batch && options.endpoint) {
            const batchOptions = typeof options.batch === 'object' ? options.batch : {}
            
            this.batchReporter = new BatchReporter({
                maxSize: batchOptions.maxSize,
                maxAge: batchOptions.maxAge,
                retryOnFailure: batchOptions.retryOnFailure,
                maxRetries: batchOptions.maxRetries,
                retryDelay: batchOptions.retryDelay,
                additionalFields: options.additionalFields,
                onFlush: async (logs) => {
                    if (!logs || !logs.length) return
                    
                    try {
                        // First write to file if configured
                        if (this.fileReporter) {
                            for (const log of logs) {
                                try {
                                    await this.fileReporter.log(log)
                                }
                                catch (err) {
                                    console.error('Error writing log to file:', err)
                                }
                            }
                        }
                        
                        // Then send to endpoint if configured
                        if (options.endpoint) {
                            await $fetch(options.endpoint, {
                                method: 'POST',
                                body: {
                                    logs: logs,
                                    app: {
                                        name: 'nuxt-server',
                                        version: process.env.npm_package_version || 'unknown'
                                    },
                                    context: {
                                        processed: true
                                    }
                                }
                            })
                        }
                    }
                    catch (error) {
                        console.error('Failed to send logs:', error)
                        
                        if (this.batchReporter && batchOptions.retryOnFailure) {
                            console.debug('Retry on failure enabled, will retry later')
                        }
                    }
                }
            })
        }
    }

    /**
     * Enqueue a log to be processed
     */
    public enqueueLog(logObj: LoggerObject): void {
        if (!this.initialized) {
        this.initialize()
        }

        // Send to batch reporter if configured
        if (this.batchReporter) {
            try {
                this.batchReporter.log(logObj)
            }
            catch (err) {
                console.error('Error in batch reporter:', err)
            }
        }
        
        // Also write directly to file reporter if configured
        // This ensures logs are always written even if batching fails
        if (this.fileReporter) {
            try {
                this.fileReporter.log(logObj)
            }
            catch (err) {
                console.error('Error in file reporter:', err)
            }
        }
    }

    /**
     * Write directly to file, bypassing the batch reporter
     * Useful for API handlers to prevent recursion
     */
    public logToFile(logObj: LoggerObject): void {
        if (!this.initialized) {
            this.initialize()
        }

        if (this.fileReporter) {
            try {
                this.fileReporter.log(logObj)
            }
            catch (err) {
                console.error('Error writing directly to file:', err)
            }
        }
        else {
            console.warn('File reporter not configured, cannot log directly to file')
        }
    }

    /**
     * Force flush any pending logs
     */
    public async flush(): Promise<void> {
        if (!this.initialized) {
            return
        }

        const promises: Promise<void>[] = []
        
        if (this.batchReporter) {
            promises.push(this.batchReporter.forceFlush())
        }

        if (this.fileReporter && typeof this.fileReporter.flush === 'function') {
            promises.push(this.fileReporter.flush())
        }
        
        await Promise.all(promises)
    }
}