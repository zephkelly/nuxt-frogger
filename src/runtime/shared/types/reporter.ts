import type { LoggerObject } from './log'

export interface IReporter {
    name: string
    log(logObj: LoggerObject): Promise<void> | void
    logBatch(logs: LoggerObject[]): Promise<void> | void
    flush?(): Promise<void> | void
    destroy?(): Promise<void> | void
}

export abstract class BaseReporter implements IReporter {
    abstract name: string
    
    abstract log(logObj: LoggerObject): Promise<void> | void
    
    logBatch(logs: LoggerObject[]): Promise<void> | void {
        for (const log of logs) {
            this.log(log)
        }
    }
    
    async flush(): Promise<void> { }
    
    async destroy(): Promise<void> { }
}
