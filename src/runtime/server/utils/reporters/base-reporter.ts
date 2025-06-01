import type { IReporter } from "~/src/runtime/shared/types/reporter"
import type { LoggerObject } from "~/src/runtime/shared/types/log"



export abstract class BaseReporter<TOptions extends Record<string, any> = Record<string, any>> implements IReporter {
    abstract name: string
    protected abstract options: TOptions;
    
    abstract log(logObj: LoggerObject): Promise<void> | void
    
    logBatch(logs: LoggerObject[]): Promise<void> | void {
        for (const log of logs) {
            this.log(log)
        }
    }
    
    async flush(): Promise<void> { }

    /**
     * This is an internal function used within the server
     * log queue service
     */
    async forceFlush(): Promise<void> {
        if (this.flush) {
            await this.flush()
        }
    }
}
