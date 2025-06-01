import { createBatchReporter } from '../utils/reporters/batch-reporter'
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
    
    private batchReporter?: IReporter;
    private directReporters: IReporter[] = [];

    private initialised: boolean = false


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
    
        //@ts-expect-error
        const batchingEnabled = config.frogger.batch !== false;
        
        const fileReporter = new FileReporter();


        
        if (batchingEnabled) {
            const downstreamReporters: IReporter[] = []
            downstreamReporters.push(fileReporter);

            const batchReporter = createBatchReporter(downstreamReporters);
            this.batchReporter = batchReporter;
        }
        else {
            this.directReporters.push(fileReporter);
        }
    }

    /**
     * Ensure service is initialised
     */
    private ensureInitialised(): boolean {
        if (!this.initialised) {
            this.initialise();
        }
        return true;
    }

    
    /**
     * Enqueue a batch of logs
     */
    public enqueueBatch(loggerObjectBatch: LoggerObjectBatch): void {
        if (!this.ensureInitialised()) return;

        const logs = loggerObjectBatch.logs;
        if (logs.length === 0) {
            return;
        }

        if (this.batchReporter) {
            try {
                this.batchReporter.logBatch(logs);
            }
            catch (err) {
                console.error(`Error in batch reporter:`, err);
            }
        }
        else {
            this.callDirectReporters('logBatch', logs);
        }
    }

    /**
     * Enqueue a log
     */
    public enqueueLog(logObj: LoggerObject): void {
        if (!this.ensureInitialised()) return;

        if (this.batchReporter) {
            try {
                this.batchReporter.log(logObj);
            }
            catch (err) {
                console.error(`Error in batch reporter:`, err);
            }
        }
        else {
            this.callDirectReporters('log', logObj);
        }
    }

    public async flush(): Promise<void> {
        if (!this.initialised) {
            return;
        }

        const flushPromises: Promise<void>[] = [];

        if (this.batchReporter) {
            if (this.batchReporter.forceFlush) {
                flushPromises.push(this.batchReporter.forceFlush().catch(err => {
                    console.error(`Error flushing batch reporter:`, err);
                }));
            }
        }
        else {
            for (const reporter of this.directReporters) {
                if (reporter.forceFlush) {
                    flushPromises.push(reporter.forceFlush().catch(err => {
                        console.error(`Error flushing ${reporter.name}:`, err);
                    }));
                }
            }
        }
        
        await Promise.allSettled(flushPromises);
    }

    public async destroy(): Promise<void> {
        if (!this.initialised) {
            return;
        }

        const destroyPromises: Promise<void>[] = [];

        if (this.batchReporter) {
            console.debug(`Destroying batch reporter`);
            if (this.batchReporter.destroy) {
                destroyPromises.push(this.batchReporter.destroy().catch(err => {
                    console.error(`Error destroying batch reporter:`, err);
                }));
            }
        }
        
        if (this.directReporters.length > 0) {
            console.debug(`Destroying ${this.directReporters.length} direct reporters`);
            for (const reporter of this.directReporters) {
                if (reporter.destroy) {
                    destroyPromises.push(reporter.destroy().catch(err => {
                        console.error(`Error destroying ${reporter.name}:`, err);
                    }));
                }
            }
        }
        
        await Promise.allSettled(destroyPromises);
        
        this.batchReporter = undefined;
        this.directReporters = [];
        this.initialised = false;
    }

    public getReporterInfo(): { 
        mode: 'batched' | 'direct';
        batchReporter?: string;
        directReporters: string[];
        downstreamReporters?: string[];
    } {
        const info: any = {
            mode: this.batchReporter ? 'batched' : 'direct',
            directReporters: this.directReporters.map(r => r.name)
        };

        if (this.batchReporter) {
            info.batchReporter = this.batchReporter.name;
            if (typeof (this.batchReporter as any).getDownstreamReporters === 'function') {
                info.downstreamReporters = (this.batchReporter as any).getDownstreamReporters();
            }
        }

        return info;
    }

    private callDirectReporters(method: 'log' | 'logBatch', data: LoggerObject | LoggerObject[]): void {
        for (const reporter of this.directReporters) {
            try {
                if (method === 'log') {
                    reporter.log(data as LoggerObject);
                }
                else {
                    reporter.logBatch(data as LoggerObject[]);
                }
            }
            catch (err) {
                console.error(`Error in direct reporter ${reporter.name}:`, err);
            }
        }
    }
}