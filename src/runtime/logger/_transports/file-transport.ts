import { defu } from 'defu'

import { uuidv7 } from '../../shared/utils/uuid'
import { FileSink } from '../../shared/sinks/file-sink'

import { BaseTransport } from './base-transport'

import type { LoggerObject } from '../../shared/types/log'
import type { FileOptions } from '../../shared/types/file'
import { DEFAULT_FILE } from '../../shared/types/file'



export interface FileTransportOptions extends FileOptions { }

/**
 * Writes logs as rotated JSON-lines files.
 *
 * All of the streaming, rotation and buffering lives in the shared
 * {@link FileSink}, which the metrics file transport also owns - so a rotation
 * fix is written once rather than twice. This class is the transport identity,
 * the log-side defaults and the lifecycle.
 */
export class FileTransport extends BaseTransport<Required<FileTransportOptions>> {
    public readonly name = 'FroggerFileTransport'
    public readonly transportId: string

    protected options: Required<FileTransportOptions>
    private sink: FileSink<LoggerObject>

    /**
     * @param options File-logging options. The server queue passes a fully
     * resolved `Required<FileOptions>` (from a `fileTransport()` entry). For
     * imperative `new FileTransport()`, any omitted field falls back to
     * {@link DEFAULT_FILE}.
     */
    constructor(options: FileOptions = {}) {
        super()
        this.transportId = `frogger-file-${uuidv7()}`

        this.options = defu(options, DEFAULT_FILE) as Required<FileTransportOptions>
        this.sink = new FileSink<LoggerObject>(this.options, 'FileTransport')
    }

    async log(logObj: LoggerObject): Promise<void> {
        await this.sink.add(logObj)
    }

    /**
     * Write a batch directly, bypassing the internal buffer. Used by
     * BatchTransport, which has already sorted the rows.
     */
    override async logBatch(logs: LoggerObject[]): Promise<void> {
        await this.sink.addBatch(logs)
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
