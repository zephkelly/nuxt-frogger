import { BatchReporter } from '../utils/reporters/batch-reporter'
import { FileReporter } from '../utils/reporters/file-reporter'

import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'

import { useRuntimeConfig } from '#imports'



/**
 * Centralized server-side log queue service
 */
export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;
    private batchReporter?: BatchReporter
    private fileReporter?: FileReporter
    private initialised: boolean = false
    private batchingEnabled: boolean = false;


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
    public initialise(): void {
        if (this.initialised) {
            return
        }

        this.initialised = true

        const config = useRuntimeConfig()
    
        const froggerModuleOptions = {
            file: config.frogger.file,
            batch: config.frogger.batch,
            endpoint: config.public.frogger.endpoint
        }
        
        //@ts-expect-error
        this.batchingEnabled = froggerModuleOptions.batch !== false;

        this.fileReporter = new FileReporter();
        
        if (this.batchingEnabled) {
            this.batchReporter = new BatchReporter({
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

                    }
                    catch (error) {
                        console.error('Failed to send logs:', error)
                        
                        if (this.batchReporter && froggerModuleOptions.batch.retryOnFailure) {
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
    public enqueueBatch(LoggerObjectBatch: LoggerObjectBatch): void {
        if (!this.initialised) {
            this.initialise()
        }

        const logs = LoggerObjectBatch.logs;
        if (logs.length === 0) {
            return;
        }

        if (this.batchingEnabled && this.batchReporter) {
            try {
                console.log('Enqueuing batch of logs:', logs.length);
                this.batchReporter.logBatch(logs);
            }
            catch (err) {
                console.error('Error in batch reporter for batch:', err);
                
                if (this.fileReporter) {
                    try {
                        this.fileReporter.writeBatch(logs)
                    }
                    catch (fileErr) {
                        console.error('Error in fallback file reporter for batch:', fileErr);
                    }
                }
            }
        }
        else if (this.fileReporter) {
            try {
                this.fileReporter.writeBatch(logs);
            }
            catch (err) {
                console.error('Error in file reporter for batch:', err);
            }
        }
    }

    /**
     * Enqueue a log to be processed
     */
    public enqueueLog(logObj: LoggerObject): void {
        if (!this.initialised) {
            this.initialise()
        }

        if (this.batchingEnabled && this.batchReporter) {
            try {
                console.log('Enqueuing single log:', logObj);
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
        
        if (this.batchingEnabled && this.batchReporter) {
            promises.push(this.batchReporter.forceFlush())
        }

        if (this.fileReporter) {
            promises.push(this.fileReporter.forceFlush());
        }
        
        await Promise.all(promises)
    }
}