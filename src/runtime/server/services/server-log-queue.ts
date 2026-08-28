import { useFroggerServerConfig } from '../../shared/utils/use-frogger-config'
import type { FroggerServerRuntimeConfig } from '../../shared/types/runtime-config'

import type { IFroggerTransport } from '../../logger/_transports/types'
import { SCRUB_HANDLED } from '../../shared/types/log'
import type { LoggerObject } from '../../shared/types/log'
import type { LoggerObjectBatch } from '../../shared/types/batch'

import type { ResolvedServerTransport } from '../../shared/types/transports'
import type { ScrubberOptions } from '../../scrubber/options'
import type { BatchOptions } from '../../shared/types/batch'

import { LogScrubber } from '../../scrubber'
import { FileTransport } from '../../logger/_transports/file-transport'
import { MemoryTransport } from '../../logger/_transports/memory-transport'
import { HttpTransport } from '../../logger/_transports/http-transport'
import { StdoutTransport } from '../../logger/_transports/stdout-transport'
import { withMinLevel } from '../../logger/_transports/level-gate'
import { WebSocketTransport } from '../../logger/_transports/websocket-transport'
import { createWebSocketStateKVLayer } from '../../websocket/state/factory'
import { BatchTransport, createBatchTransport } from '../../logger/_transports/batch-transport'
import { froggerInternal } from '../../shared/utils/internal-log'
import { getServerResource } from '../../shared/utils/resolve-resource'
import { setSpanSink } from '../../shared/utils/span-sink'
import { recordDropped } from '../../shared/utils/health'
import { decideBatch, DEFAULT_SAMPLING, type ResolvedSampling } from '../../shared/utils/sampling'
import type { SpanObject } from '../../shared/types/span'
import type { FroggerResource } from '../../shared/types/resource'

export class ServerLogQueueService {
    private static instance: ServerLogQueueService | null = null;

    private batchTransporter?: BatchTransport;
    private directTransporters: IFroggerTransport[] = [];
    private downstreamTransporters: IFroggerTransport[] = [];

    private scrubber: LogScrubber | null = null;
    private initialised: boolean = false
    /** Resolved once per process, so it carries this boot's instance id. */
    private resource: FroggerResource | undefined;

    /**
     * Completed spans awaiting delivery. Spans ride the log batch envelope, so
     * they are buffered here and attached to the next outgoing batch rather
     * than getting a pipeline of their own.
     */
    private spans: SpanObject[] = [];

    /** Ceiling, for the same reason the log buffer has one. */
    private readonly maxBufferedSpans = 2048;

    /** Trace sampling policy. `rate: 1` means every decision is a keep. */
    private sampling: ResolvedSampling = DEFAULT_SAMPLING;

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

        const config = useFroggerServerConfig()

        this.resource = getServerResource(config.resource);
        this.sampling = config.sampling ?? DEFAULT_SAMPLING;

        // Completed spans land here and ride the next log batch.
        setSpanSink(span => this.enqueueSpan(span));

        const scrubConfig = config.scrub;
        if (scrubConfig) {
            this.scrubber = new LogScrubber(scrubConfig);
        }

        const batchingEnabled = config.batch !== false;

        let websocketTransport: IFroggerTransport | undefined;
        if (config.websocket) {
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

            const batchTransporter = createBatchTransport(this.downstreamTransporters, {
                // Spans ride the same flush as the logs they bracket.
                getPendingSpans: () => this.takeSpans(),
            });
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
    private buildConfiguredTransports(config: FroggerServerRuntimeConfig): IFroggerTransport[] {
        const configured = config.transports ?? [];

        const transporters: IFroggerTransport[] = [];
        for (const t of configured) {
            try {
                // Every constructed transport is wrapped in its own severity
                // gate, so `minLevel` works uniformly across built-in and
                // user-authored destinations.
                if (t.type === 'file') {
                    transporters.push(withMinLevel(new FileTransport(t.options), t.minLevel));
                    continue;
                }

                if (t.type === 'stdout') {
                    transporters.push(withMinLevel(new StdoutTransport({ name: t.name }), t.minLevel));
                    continue;
                }

                if (t.type === 'memory') {
                    transporters.push(withMinLevel(new MemoryTransport({ name: t.name }), t.minLevel));
                    continue;
                }

                transporters.push(withMinLevel(new HttpTransport({
                    baseUrl: t.baseUrl,
                    endpoint: t.endpoint,
                    apiKey: t.apiKey,
                    apiKeyLocation: t.apiKeyLocation,
                    headers: t.headers,
                    vendor: t.vendor,
                    shape: t.shape,
                    timeout: t.timeout,
                    retryOnFailure: t.retryOnFailure,
                    maxRetries: t.maxRetries,
                    retryDelay: t.retryDelay,
                    maxBatchEvents: t.maxBatchEvents,
                    maxBodyBytes: t.maxBodyBytes,
                }), t.minLevel));
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

        // A relayed batch can carry spans as well as logs, and a spans-only
        // batch is legitimate: a span that did work without logging inside it.
        if (loggerObjectBatch.spans?.length) {
            for (const span of loggerObjectBatch.spans) {
                span.resource ??= loggerObjectBatch.resource ?? this.resource;
                span.session ??= loggerObjectBatch.session;
                span.user ??= loggerObjectBatch.user;
                this.enqueueSpan(span);
            }
        }

        let logs = loggerObjectBatch.logs;
        if (logs.length === 0) {
            return;
        }

        // A relay re-batches under its own app identity, so the origin app only
        // survives if the envelope's name is stamped onto each log first.
        const originName = loggerObjectBatch.app?.name;
        if (originName) {
            const originVersion = loggerObjectBatch.app?.version ?? '';
            for (const log of logs) {
                log.source ??= { name: originName, version: originVersion };
            }
        }

        // Denormalise the envelope onto each row: transports receive a bare
        // `LoggerObject[]`, so anything only present on the envelope is lost.
        // `??=` so a row that already carries its origin's resource keeps it
        // across a relay hop.
        const resource = loggerObjectBatch.resource;
        const observedAt = loggerObjectBatch.meta?.received?.at;
        const session = loggerObjectBatch.session;
        const user = loggerObjectBatch.user;

        if (resource || observedAt !== undefined || session || user) {
            for (const log of logs) {
                if (resource) log.resource ??= resource;
                if (observedAt !== undefined) log.obsTime ??= observedAt;
                if (session) log.session ??= session;
                if (user) log.user ??= user;
            }
        }

        // Sampling is decided here rather than at emit time, because this is
        // the first point that holds a COMPLETE unit of work: a per-line
        // decision produces traces with holes, which read as dropped requests.
        //
        // `decideBatch` returns the SAME array when nothing is filtered, so the
        // result replaces the local binding rather than mutating in place.
        const sampled = decideBatch(logs, this.sampling);
        if (sampled.length !== logs.length) {
            recordDropped('overflow', logs.length - sampled.length, 'trace sampled out');
        }
        if (sampled.length === 0) return;
        logs = sampled;

        // Rows stamped by an in-process server logger already carry that
        // logger's scrub disposition (rules or an explicit `scrub: false`);
        // re-scrubbing them here would override the per-logger opt-out.
        // Network batches are parsed from JSON, which cannot carry the symbol,
        // so client rows always pass through the scrubber. The stamp is
        // stripped either way so transports never see it.
        const unhandled: LoggerObject[] = [];
        for (const log of logs) {
            if (log[SCRUB_HANDLED]) {
                delete log[SCRUB_HANDLED];
            }
            else {
                unhandled.push(log);
            }
        }

        if (this.scrubber && unhandled.length > 0) {
            this.scrubber.scrubBatch(unhandled);
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
            this.callDirectReporters('logBatch', logs, this.takeSpans());
        }
    }

    /**
     * Buffer one completed span. Bounded and drop-oldest, matching every other
     * buffer in the pipeline - a span record must never be the thing that grows
     * without limit.
     */
    public enqueueSpan(span: SpanObject): void {
        span.resource ??= this.resource;

        this.spans.push(span);

        if (this.spans.length > this.maxBufferedSpans) {
            const overflow = this.spans.length - this.maxBufferedSpans;
            this.spans.splice(0, overflow);
            recordDropped('overflow', overflow, 'span buffer exceeded its ceiling');
        }
    }

    /** Take the buffered spans, leaving the buffer empty. */
    public takeSpans(): SpanObject[] {
        if (this.spans.length === 0) return [];
        const taken = this.spans;
        this.spans = [];
        return taken;
    }

    public enqueueLog(logObj: LoggerObject): void {
        if (!this.ensureInitialised()) return;

        // An in-process row never crosses an ingest route, so this is its only
        // chance to pick up the deployment identity.
        logObj.resource ??= this.resource;

        if (logObj[SCRUB_HANDLED]) {
            delete logObj[SCRUB_HANDLED];
        }
        else if (this.scrubber) {
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

    /**
     * Shutdown/crash flush: empty the batch buffer regardless of the sorting
     * window, then flush every downstream transport's own buffer (file
     * streams, retry queues). `flush()` is the polite runtime flush; this is
     * the one to call when the process is about to exit.
     */
    public async drain(): Promise<void> {
        if (!this.initialised) {
            return;
        }

        if (!this.batchTransporter) {
            await this.flush();
            return;
        }

        try {
            await this.batchTransporter.drain();
        }
        catch (err) {
            froggerInternal.error('Error draining batch transporter:', err);
        }

        const downstreamFlushes = this.downstreamTransporters
            .filter(t => t.forceFlush)
            .map(t => t.forceFlush!().catch(err => {
                froggerInternal.error(`Error flushing ${t.name} during drain:`, err);
            }));

        await Promise.allSettled(downstreamFlushes);
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

    private callDirectReporters(
        method: 'log' | 'logBatch',
        data: LoggerObject | LoggerObject[],
        spans?: SpanObject[],
    ): void {
        for (const reporter of this.directTransporters) {
            try {
                if (method === 'log') {
                    reporter.log(data as LoggerObject);
                }
                else {
                    reporter.logBatch(data as LoggerObject[], spans);
                }
            }
            catch (err) {
                froggerInternal.error(`Error in direct reporter ${reporter.name}:`, err);
            }
        }
    }
}