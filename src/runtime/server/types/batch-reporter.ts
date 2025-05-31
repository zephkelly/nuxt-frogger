import type { LoggerObject } from '../../shared/types/log';
import type { BatchOptions } from '../../shared/types/batch';


export interface BatchReporterOptions extends BatchOptions {
    
    /**
     * Function to call when flushing logs
     */
    onFlush: (logs: LoggerObject[]) => Promise<void>;

    /**
     * Log levels to include (undefined means all levels)
     */
    levels?: number[];
}