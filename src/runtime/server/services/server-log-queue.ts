import { useRuntimeConfig } from '#imports'

import type { IFroggerTransport } from '../../logger/_transports/types'
import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'

import type { ResolvedServerTransport } from '../../shared/types/transports'
import type { ScrubberOptions } from '../../scrubber/options'
import type { BatchOptions } from '../../shared/types/batch'

import { LogScrubber } from '../../scrubber'
import { FileTransport } from '../../logger/_transports/file-transport'
import { HttpTransport } from '../../logger/_transports/http-transport'
import { WebSocketTransport } from '../../logger/_transports/websocket-transport'
import { createWebSocketStateKVLayer } from '../../websocket/state/factory'
import { BatchTransport, createBatchTransport } from '../../logger/_transports/batch-transport'
import { froggerInternal } from '../../shared/utils/internal-log'

export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;

    private batchTransporter?: BatchTransport;
    private directTransporters: IFroggerTransport[] = [];
    private downstreamTransporters: IFroggerTransport[] = [];

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

        const scrubConfig = config.frogger.scrub as ScrubberOptions | false;
        if (scrubConfig) {
            this.scrubber = new LogScrubber(scrubConfig);
        }

        const batchingEnabled = (config.frogger.batch as BatchOptions | false) !== false;

        let websocketTransport: IFroggerTransport | undefined;
        //@ts-ignore
        if (config.frogger.websocket) {
            try {
                const stateLayer = createWebSocketStateKVLayer('frogger-websocket');

                // Pass storage to WebSocketTransport (can be null)
                websocketTransport = WebSocketTransport.getInstance(stateLayer);
            } catch (error) {
                froggerInternal.error('ServerLogQueueService: Failed to initialize WebSocket transport:', error);
            }
        }

        // All persistent destinations are now declarative (`transports`): a bare
        // install has none and logs to console only. File logging is just a
        // `fileTransport()` entry. User array order is preserved.
        const configuredTransports = this.buildConfiguredTransports(config);

        if (batchingEnabled) {
            if (websocketTransport) {
                this.downstreamTransporters.push(websocketTransport);
            }
            this.downstreamTransporters.push(...configuredTransports);

            const batchTransporter = createBatchTransport(this.downstreamTransporters);
            this.batchTransporter = batchTransporter;
        }
        else {
            if (websocketTransport) {
                this.directTransporters.push(websocketTransport);
            }
            this.directTransporters.push(...configuredTransports);
        }
    }

    /**
     * Construct a transport for every declarative server entry in
     * `runtimeConfig.frogger.transports` — `file` entries become a
     * `FileTransport`, everything else an `HttpTransport`. User array order is
     * preserved; failures are isolated per-transport so one bad entry can't take
     * down the whole queue.
     */
    private buildConfiguredTransports(config: ReturnType<typeof useRuntimeConfig>): IFroggerTransport[] {
        //@ts-ignore — frogger.transports is injected by the module
        const configured = (config.frogger.transports ?? []) as ResolvedServerTransport[];

        const transporters: IFroggerTransport[] = [];
        for (const t of configured) {
            try {
                if (t.type === 'file') {
                    transporters.push(new FileTransport(t.options));
                    continue;
                }

                transporters.push(new HttpTransport({
                    baseUrl: t.baseUrl,
                    endpoint: t.endpoint,
                    apiKey: t.apiKey,
                    apiKeyLocation: t.apiKeyLocation,
                    headers: t.headers,
                    vendor: t.vendor,
                    timeout: t.timeout,
                    retryOnFailure: t.retryOnFailure,
                    maxRetries: t.maxRetries,
                    retryDelay: t.retryDelay,
                    maxBatchEvents: t.maxBatchEvents,
                    maxBodyBytes: t.maxBodyBytes,
                }));
            }
            catch (err) {
                froggerInternal.error('ServerLogQueueService: failed to construct configured transport', t.name, err);
            }
        }
        return transporters;
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
                froggerInternal.error(`Error in batch reporter:`, err);
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
                froggerInternal.error(`Error in batch reporter:`, err);
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
                    froggerInternal.error(`Error flushing batch transporter:`, err);
                }));
            }
        }
        else {
            for (const reporter of this.directTransporters) {
                if (reporter.forceFlush) {
                    flushPromises.push(reporter.forceFlush().catch(err => {
                        froggerInternal.error(`Error flushing ${reporter.name}:`, err);
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
                    froggerInternal.error(`Error destroying batch reporter:`, err);
                }));
            }
        }

        if (this.directTransporters.length > 0) {
            for (const reporter of this.directTransporters) {
                if (reporter.destroy) {
                    destroyPromises.push(reporter.destroy().catch(err => {
                        froggerInternal.error(`Error destroying ${reporter.name}:`, err);
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
                froggerInternal.error(`Error in direct reporter ${reporter.name}:`, err);
            }
        }
    }
}