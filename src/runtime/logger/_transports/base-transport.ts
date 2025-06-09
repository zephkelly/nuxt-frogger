import type { IFroggerTransport } from "./types";
import type { LoggerObject } from "~/src/runtime/shared/types/log"



export abstract class BaseTransport<TOptions extends Record<string, any> = Record<string, any>> implements IFroggerTransport {
    abstract name: string
    abstract transportId: string;

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

    async destroy(): Promise<void> { }
}
