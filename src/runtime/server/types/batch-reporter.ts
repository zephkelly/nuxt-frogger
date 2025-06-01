import type { LoggerObject } from '../../shared/types/log';
import type { BatchOptions } from '../../shared/types/batch';
import type { IReporter } from '~/src/runtime/shared/types/internal-reporter';



export interface BatchReporterOptions extends BatchOptions {
    downstreamReporters?: IReporter[];

    /**
     * Function to call when flushing logs
     */
    onFlush?: (logs: LoggerObject[]) => Promise<void>;

    /**
     * Log levels to include (undefined means all levels)
     */
    levels?: number[];

    addDownstreamReporter?: (reporter: IReporter) => void;
    removeDownstreamReporter?: (reporter: IReporter) => void;
    getDownstreamReporters?: () => IReporter[];
}