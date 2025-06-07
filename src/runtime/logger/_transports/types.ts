import type { LoggerObject } from "../../shared/types/log";



export interface IFroggerTransport {
    name: string
    transportId: string
    
    log(logObj: LoggerObject): Promise<void> | void
    logBatch(logs: LoggerObject[]): Promise<void> | void

    flush?(): Promise<void> | void
    forceFlush?(): Promise<void>
    destroy?(): Promise<void>
}