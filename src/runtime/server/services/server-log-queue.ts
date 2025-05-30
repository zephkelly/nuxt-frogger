import { BatchReporter } from '../utils/reporters/batch-reporter'
import { FileReporter } from '../utils/reporters/file-reporter'

import type { LoggerObject } from '../../shared/types/log'
import type { LogBatch } from '../../shared/types/batch'
import type { ServerLoggerOptions } from '../types/logger'

import { useRuntimeConfig } from '#imports'



/**
 * Centralized server-side log queue service
 */
export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;
    private batchReporter?: BatchReporter
    private fileReporter?: FileReporter
    private initialised: boolean = false


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

            ServerLogQueueService.instance.initialise();
        }
        return ServerLogQueueService.instance;
    }

    /**
     * Initialise the queue service with options
     */
    public initialise(options?: ServerLoggerOptions): void {
        if (this.initialised) {
            return
        }

        this.initialised = true

        const config = useRuntimeConfig()
        const froggerConfig = config.frogger || {}
        const publicConfig = config.public?.frogger || {}

        const mergedOptions = {
            file: options?.file ?? froggerConfig.file ?? {
                directory: 'logs',
                fileNameFormat: 'YYYY-MM-DD.log',
                maxSize: 10 * 1024 * 1024,
            },
            batch: options?.batch ?? {
                maxSize: publicConfig.batch?.maxSize ?? 100,
                maxAge: publicConfig.batch?.maxAge ?? 5000,
                retryOnFailure: publicConfig.batch?.retryOnFailure ?? true,
                maxRetries: publicConfig.batch?.maxRetries ?? 3,
                retryDelay: publicConfig.batch?.retryDelay ?? 1000,
                sortingWindowMs: options?.batch?.sortingWindowMs ?? 2000
            },
            endpoint: options?.endpoint ?? publicConfig.endpoint ?? '/api/_frogger/logs'
        }

        if (mergedOptions.file) {
            const fileOptions = typeof mergedOptions.file === 'object' ? mergedOptions.file : {}
            this.fileReporter = new FileReporter({
                directory: fileOptions.directory,
                fileNameFormat: fileOptions.fileNameFormat,
                maxSize: fileOptions.maxSize,
            })
        }
        
        if (mergedOptions.batch) {
            const batchOptions = typeof mergedOptions.batch === 'object' ? mergedOptions.batch : {}

            this.batchReporter = new BatchReporter({
                maxSize: batchOptions.maxSize,
                maxAge: batchOptions.maxAge,
                retryOnFailure: batchOptions.retryOnFailure,
                maxRetries: batchOptions.maxRetries,
                retryDelay: batchOptions.retryDelay,
                sortingWindowMs: batchOptions.sortingWindowMs,
                onFlush: async (logs) => {
                    if (!logs || !logs.length) return
                    
                    try {
                        if (this.fileReporter) {
                            try {
                                await this.fileReporter.writeBatch(logs)
                            }
                            catch (err) {
                                console.error('Error writing log to file:', err)
                            }
                        }

                        if (mergedOptions.endpoint) {
                            await $fetch(mergedOptions.endpoint, {
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
                            throw error
                        }
                    }
                }
            })
        }
    }

    
    /**
     * Enqueue a batch of logs efficiently
     */
    public enqueueBatch(logBatch: LogBatch): void {
        if (!this.initialised) {
            this.initialise()
        }

        const logs = logBatch.logs;
        if (logs.length === 0) {
            return;
        }

        if (this.batchReporter) {
            try {
                this.batchReporter.logBatch(logs);
            }
            catch (err) {
                console.error('Error in batch reporter for batch:', err);
                
                if (this.fileReporter) {
                    for (const log of logs) {
                        this.fileReporter.writeBatch(logs).catch(fileErr => {
                            console.error('Error in fallback file batch write:', fileErr);
                        });
                    }
                }
            }
        }
        else if (this.fileReporter) {
            this.fileReporter.writeBatch(logs).catch(err => {
                console.error('Error in direct file batch write:', err);
            });
        }
    }

    /**
     * Enqueue a log to be processed
     */
    public enqueueLog(logObj: LoggerObject): void {
        if (!this.initialised) {
            this.initialise()
        }

        if (this.batchReporter) {
            try {
                this.batchReporter.log(logObj)
            }
            catch (err) {
                console.error('Error in batch reporter:', err)
                
                if (this.fileReporter) {
                    try {
                        this.fileReporter.log(logObj)
                    }
                    catch (fileErr) {
                        console.error('Error in fallback file reporter:', fileErr)
                    }
                }
            }
        }
        else if (this.fileReporter) {
            try {
                this.fileReporter.log(logObj)
            }
            catch (err) {
                console.error('Error in file reporter:', err)
            }
        }
    }

    /**
     * Force flush any pending logs
     */
    public async flush(): Promise<void> {
        if (!this.initialised) {
            return
        }

        const promises: Promise<void>[] = []
        
        if (this.batchReporter) {
            promises.push(this.batchReporter.forceFlush())
        }

        if (this.fileReporter) {
            promises.push(this.fileReporter.forceFlush());
        }
        
        await Promise.all(promises)
    }
}