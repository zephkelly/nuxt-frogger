import type { MetricObject } from '../shared/types/metric'



export interface IFroggerMetricsTransport {
    name: string
    transportId: string

    metric(metricObj: MetricObject): Promise<void> | void
    metricBatch(metrics: MetricObject[]): Promise<void> | void

    flush?(): Promise<void> | void
    forceFlush?(): Promise<void>
    destroy?(): Promise<void>
}
