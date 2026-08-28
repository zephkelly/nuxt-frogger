import type { LoggerObject } from "./log";
import type { SpanObject } from "./span";
import type { FroggerResource } from "./resource";


export interface BatchOptions {
    /**
     * Records per exported batch. Reaching it schedules a flush; it is NOT a
     * ceiling on how much can be buffered - that is {@link maxQueueSize}.
     *
     * OTel calls this `maxExportBatchSize`.
     */
    maxSize?: number

    /**
     * Hard ceiling on buffered records. Past it the OLDEST are dropped and
     * counted, rather than the buffer growing until the process dies.
     *
     * A dead HTTP sink used to grow this buffer without bound while failed
     * batches piled up in retry closures, taking the host application with it.
     * OTel's BatchLogRecordProcessor names the same knob.
     *
     * @default 2048
     */
    maxQueueSize?: number

    /**
     * Batches allowed to be in retry at once. Past it the oldest in-flight
     * retry is abandoned, so a sink that never recovers cannot pin an
     * unbounded amount of memory in `setTimeout` closures.
     *
     * @default 3
     */
    maxConcurrentRetries?: number

    maxAge?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
    sortingWindowMs?: number
}

/**
 * Wire-format version of the log envelope. Bumped only on a field removal or a
 * semantic change; additive fields do not bump it. Readers (nuxt-observe)
 * branch on this rather than sniffing for field presence.
 */
export const LOG_BATCH_SCHEMA = 'frogger.logs/1' as const;

export interface LoggerObjectBatch {
    logs: LoggerObject[];

    /**
     * Completed spans. Carried in this envelope rather than a parallel
     * pipeline: spans share the batch's resource, session and trace, and giving
     * them their own route/transport/queue would triple the surface to deliver
     * one more record type.
     */
    spans?: SpanObject[];
    app?: {
        name?: string;
        version?: string;
    }
    /**
     * Deployment identity for every record in this batch. Rides the envelope
     * once and is denormalised onto rows at ingest, the same idiom
     * `MetricContext` already uses.
     */
    resource?: FroggerResource;
    /**
     * Browser session for every row in this batch, denormalised onto rows at
     * ingest. Rides the envelope once, the same idiom the metrics pipeline
     * uses for its device context.
     */
    session?: { id: string; sampled: boolean };
    /** Acting user for every row in this batch, denormalised like `session`. */
    user?: string;
    meta?: {
        /** Wire-format version, see {@link LOG_BATCH_SCHEMA}. */
        schema?: string;
        processed?: true;
        processChain?: string[];
        source?: string;
        time?: number;
        /**
         * Server-authoritative receipt facts, stamped by the ingest route.
         * Everything else on this envelope (`app`, `source`, `time`) is
         * client-declared and must be treated as untrusted by any reader.
         */
        received?: {
            /** Epoch ms the collector accepted this batch. */
            at: number;
            /** Peer address the batch arrived from, when resolvable. */
            ip?: string;
        };
    },
}
