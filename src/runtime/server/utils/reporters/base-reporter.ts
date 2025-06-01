import type { IReporter } from "~/src/runtime/shared/types/reporter"
import type { LoggerObject } from "~/src/runtime/shared/types/log"



export abstract class BaseReporter implements IReporter {
    abstract name: string
    protected abstract options: Record<string, any>
    
    abstract log(logObj: LoggerObject): Promise<void> | void
    
    logBatch(logs: LoggerObject[]): Promise<void> | void {
        for (const log of logs) {
            this.log(log)
        }
    }
    
    async flush(): Promise<void> { }

    /**
     * Force flush any pending logs, allows reporters to perform other operations
     * before final flush. This is an internal function used within the server
     * log queue service
     */
    async forceFlush(): Promise<void> {
        if (this.flush) {
            await this.flush()
        }
    }
}
