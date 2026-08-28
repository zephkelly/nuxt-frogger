import { defu } from 'defu'

import { uuidv7 } from '../../shared/utils/uuid'
import { FileSink } from '../../shared/sinks/file-sink'

import { BaseMetricsTransport } from './base-metrics-transport'
import type { MetricObject } from '../shared/types/metric'
import type { FileOptions } from '../../shared/types/file'
import { DEFAULT_METRICS_FILE } from '../shared/utils/resolve-metrics'



export interface MetricsFileTransportOptions extends FileOptions { }

/**
 * Writes raw metric events as rotated JSON-lines.
 *
 * All of the streaming, rotation and buffering lives in the shared
 * {@link FileSink}; this class is only the transport identity, the metrics
 * defaults (a distinct `logs/metrics/` directory so metric files never mingle
 * with log files) and the transport lifecycle.
 */
export class MetricsFileTransport extends BaseMetricsTransport<Required<MetricsFileTransportOptions>> {
    public readonly name = 'FroggerMetricsFileTransport'
    public readonly transportId: string

    protected options: Required<MetricsFileTransportOptions>
    private sink: FileSink<MetricObject>

    constructor(options: FileOptions = {}) {
        super()
        this.transportId = `frogger-metrics-file-${uuidv7()}`

        this.options = defu(options, DEFAULT_METRICS_FILE) as Required<MetricsFileTransportOptions>
        this.sink = new FileSink<MetricObject>(this.options, 'MetricsFileTransport')
    }

    async metric(metricObj: MetricObject): Promise<void> {
        await this.sink.add(metricObj)
    }

    override async metricBatch(metrics: MetricObject[]): Promise<void> {
        await this.sink.addBatch(metrics)
    }

    override async flush(): Promise<void> {
        await this.sink.flush()
    }

    override async forceFlush(): Promise<void> {
        await this.sink.close()
    }

    /** Whether this transport has given up on the filesystem. */
    isDegraded(): boolean {
        return this.sink.isDegraded()
    }
}
