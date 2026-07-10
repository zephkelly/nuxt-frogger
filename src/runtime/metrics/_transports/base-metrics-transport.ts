import type { IFroggerMetricsTransport } from './types'
import type { MetricObject } from '../shared/types/metric'



export abstract class BaseMetricsTransport<TOptions extends Record<string, any> = Record<string, any>> implements IFroggerMetricsTransport {
    abstract name: string
    abstract transportId: string

    protected abstract options: TOptions

    abstract metric(metricObj: MetricObject): Promise<void> | void

    metricBatch(metrics: MetricObject[]): Promise<void> | void {
        for (const m of metrics) {
            this.metric(m)
        }
    }

    async flush(): Promise<void> { }

    /** Internal helper used by the server metrics queue on shutdown. */
    async forceFlush(): Promise<void> {
        if (this.flush) {
            await this.flush()
        }
    }

    async destroy(): Promise<void> { }
}
