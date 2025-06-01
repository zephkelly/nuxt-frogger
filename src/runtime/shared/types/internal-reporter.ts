import type { LoggerObject } from './log'



export interface IReporter {
    name: string
    
    log(logObj: LoggerObject): Promise<void> | void
    logBatch(logs: LoggerObject[]): Promise<void> | void

    flush?(): Promise<void> | void
    forceFlush?(): Promise<void>
    destroy?(): Promise<void>
}