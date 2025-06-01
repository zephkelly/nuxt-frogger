import { BatchReporter } from '../utils/reporters/batch-reporter'
import { FileReporter } from '../utils/reporters/file-reporter'

import type { IReporter } from '../../shared/types/reporter'
import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'

import { useRuntimeConfig } from '#imports'



/**
 * Centralised server-side log queue service
 */
export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;
    private primaryReporter?: IReporter;
    private allReporters: IReporter[] = [];
    private initialised: boolean = false
    private batchingEnabled: boolean = false;


    /**
     * Private to prevent direct instantiation
     */
    private constructor() { }

    public static getInstance(): ServerLogQueueService {
        if (!ServerLogQueueService.instance) {
            ServerLogQueueService.instance = new ServerLogQueueService();

            ServerLogQueueService.instance.initialise();
        }
        return ServerLogQueueService.instance;
    }

    /**
     * Initialise queue service with options
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

        const fileReporter = new FileReporter();
        this.allReporters.push(fileReporter);
        
        if (this.batchingEnabled) {
            const batchReporter = new BatchReporter({
                onFlush: async (logs) => {
                    if (!logs || !logs.length) return;
                    
                    try {
                        await fileReporter.logBatch(logs);
                    }
                    catch (err) {
                        console.error('Error writing batch to file:', err);
                        throw err;
                    }
                }
            });
            
            this.allReporters.push(batchReporter);
            this.primaryReporter = batchReporter;
        }
        else {
            this.primaryReporter = fileReporter;
            
            console.debug('Batching disabled: FileReporter (direct)');
        }
    }

    
    /**
     * Enqueue a batch of logs
     */
    public enqueueBatch(loggerObjectBatch: LoggerObjectBatch): void {
        if (!this.initialised) {
            this.initialise();
        }

        const logs = loggerObjectBatch.logs;
        if (logs.length === 0) {
            return;
        }

        if (!this.primaryReporter) {
            console.error('No primary reporter configured');
            return;
        }

        try {
            console.debug(`Enqueuing batch of ${logs.length} logs via ${this.primaryReporter.name}`);
            this.primaryReporter.logBatch(logs);
        }
        catch (err) {
            console.error(`Error in primary reporter (${this.primaryReporter.name}) for batch:`, err);
        }
    }

    /**
     * Enqueue a log
     */
    public enqueueLog(logObj: LoggerObject): void {
        if (!this.initialised) {
            this.initialise();
        }

        if (!this.primaryReporter) {
            console.error('No primary reporter configured');
            return;
        }

        try {
            console.debug(`Enqueuing single log via ${this.primaryReporter.name}`);
            this.primaryReporter.log(logObj);
        }
        catch (err) {
            console.error(`Error in primary reporter (${this.primaryReporter.name}):`, err);
        }
    }

    public async flush(): Promise<void> {
        if (!this.initialised) {
            return;
        }

        const promises = this.allReporters.map(async (reporter) => {
            try {
                if (reporter.forceFlush) {
                    await reporter.forceFlush();
                }
            }
            catch (err) {
                console.error(`Error flushing ${reporter.name}:`, err);
            }
        });
        
        await Promise.allSettled(promises);
    }

    public async destroy(): Promise<void> {
        if (!this.initialised) {
            return;
        }

        const promises = this.allReporters.map(async (reporter) => {
            try {
                if (reporter.destroy) {
                    await reporter.destroy();
                }
            }
            catch (err) {
                console.error(`Error destroying ${reporter.name}:`, err);
            }
        });
        
        await Promise.allSettled(promises);
        
        this.allReporters = [];
        this.primaryReporter = undefined;
        this.initialised = false;
    }

    public getReporterInfo(): Record<string, any> {
        return {
            primary: this.primaryReporter ? this.primaryReporter.name : 'None',
            reporters: this.allReporters.map(r => r.name)
        };
    }
}