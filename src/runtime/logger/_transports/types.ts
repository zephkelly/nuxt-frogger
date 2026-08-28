import type { LoggerObject } from "../../shared/types/log";
import type { SpanObject } from "../../shared/types/span";



export interface IFroggerTransport {
    name: string
    transportId: string

    log(logObj: LoggerObject): Promise<void> | void

    /**
     * Deliver a batch. `spans` rides the same call because spans travel in the
     * log batch envelope; a transport that has no use for them ignores the
     * argument, which is why it is optional rather than a second method every
     * implementation would have to stub.
     */
    logBatch(logs: LoggerObject[], spans?: SpanObject[]): Promise<void> | void

    flush?(): Promise<void> | void
    forceFlush?(): Promise<void>
    destroy?(): Promise<void>
}