import { WebSocketTransport } from '../../logger/_transports/websocket-transport'
import { BatchTransport, createBatchTransport } from '../../logger/_transports/batch-transport'
import { FileTransport } from '../../logger/_transports/file-transport'

import type { IFroggerTransport } from '../../logger/_transports/types'

import { LogScrubber } from '../../scrubber'
import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'

import { useRuntimeConfig } from '#imports'



export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;

    private batchTransporter?: BatchTransport;
    private directTransporters: IFroggerTransport[] = [];

    private scrubber: LogScrubber | null = null;
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

    public initialise(): void {
        if (this.initialised) {
            return
        }

        this.initialised = true

        const config = useRuntimeConfig()

        //@ts-expect-error
        if (config.frogger.scrub) {
            //@ts-ignore
            this.scrubber = new LogScrubber(config.frogger.scrub);
        }

        //@ts-ignore
        const batchingEnabled = config.frogger.batch !== false;

        const fileTransporter = new FileTransport();

        let websocketTransport: IFroggerTransport | undefined;
        //@ts-ignore
        if (config.frogger.websocket) {
            websocketTransport = WebSocketTransport.getInstance();
        }

        if (batchingEnabled) {
            const downstreamTransporters: IFroggerTransport[] = []
            downstreamTransporters.push(fileTransporter);
            if (websocketTransport) {
                downstreamTransporters.push(websocketTransport);
            }

            const batchTransporter = createBatchTransport(downstreamTransporters);
            this.batchTransporter = batchTransporter;
        }
        else {
            this.directTransporters.push(fileTransporter);
            if (websocketTransport) {
                this.directTransporters.push(websocketTransport);
            }
        }
    }

    private ensureInitialised(): boolean {
        if (!this.initialised) {
            this.initialise();
        }
        return true;
    }


    public enqueueBatch(loggerObjectBatch: LoggerObjectBatch): void {
        if (!this.ensureInitialised()) return;

        const logs = loggerObjectBatch.logs;
        if (logs.length === 0) {
            return;
        }

        if (this.scrubber) {
            this.scrubber.scrubBatch(logs);
        }

        if (this.batchTransporter) {
            try {
                this.batchTransporter.logBatch(logs);
            }
            catch (err) {
                console.error(`Error in batch reporter:`, err);
            }
        }
        else {
            this.callDirectReporters('logBatch', logs);
        }
    }

    public enqueueLog(logObj: LoggerObject): void {
        if (!this.ensureInitialised()) return;

        if (this.scrubber) {
            this.scrubber.scrubLoggerObject(logObj);
        }

        if (this.batchTransporter) {
            try {
                this.batchTransporter.log(logObj);
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

        if (this.batchTransporter) {
            if (this.batchTransporter.forceFlush) {
                flushPromises.push(this.batchTransporter.forceFlush().catch(err => {
                    console.error(`Error flushing batch transporter:`, err);
                }));
            }
        }
        else {
            for (const reporter of this.directTransporters) {
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

        if (this.batchTransporter) {
            if (this.batchTransporter.destroy) {
                destroyPromises.push(this.batchTransporter.destroy().catch(err => {
                    console.error(`Error destroying batch reporter:`, err);
                }));
            }
        }

        if (this.directTransporters.length > 0) {
            for (const reporter of this.directTransporters) {
                if (reporter.destroy) {
                    destroyPromises.push(reporter.destroy().catch(err => {
                        console.error(`Error destroying ${reporter.name}:`, err);
                    }));
                }
            }
        }

        await Promise.allSettled(destroyPromises);

        this.batchTransporter = undefined;
        this.directTransporters = [];
        this.initialised = false;
    }

    public addTransport(transport: IFroggerTransport): void {
        if (!this.ensureInitialised()) return;
        if (this.batchTransporter) {
            if (typeof this.batchTransporter.addDownstreamTransporter === 'function') {
                this.batchTransporter.addDownstreamTransporter(transport);
            }
            else {
                this.directTransporters.push(transport);
            }
        }
        else {
            this.directTransporters.push(transport);
        }
    }

    public removeTransport(transport: IFroggerTransport): void {
        if (!this.ensureInitialised()) return;

        if (this.batchTransporter && typeof this.batchTransporter.removeDownstreamTransporter === 'function') {
            this.batchTransporter.removeDownstreamTransporter(transport);
        }
        else {
            const index = this.directTransporters.indexOf(transport);
            if (index > -1) {
                this.directTransporters.splice(index, 1);
            }
        }
    }

    public clearTransporters(): void {
        if (!this.ensureInitialised()) return;

        if (this.batchTransporter && typeof this.batchTransporter.removeDownstreamTransporter === 'function') {
            this.batchTransporter.clearDownstreamTransporters();
        }
        else {
            this.directTransporters = [];
        }
    }

    public getReporterInfo(): {
        mode: 'batched' | 'direct';
        batchTransporter?: string;
        directTransporters: string[];
        downstreamReporters?: string[];
    } {
        const info: any = {
            mode: this.batchTransporter ? 'batched' : 'direct',
            directTransporters: this.directTransporters.map(r => r.name)
        };

        if (this.batchTransporter) {
            info.batchTransporter = this.batchTransporter.name;
            if (typeof this.batchTransporter.getDownstreamTransporters === 'function') {
                info.downstreamReporters = this.batchTransporter.getDownstreamTransporters();
            }
        }

        return info;
    }

    private callDirectReporters(method: 'log' | 'logBatch', data: LoggerObject | LoggerObject[]): void {
        for (const reporter of this.directTransporters) {
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