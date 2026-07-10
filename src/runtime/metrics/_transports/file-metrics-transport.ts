import { join } from 'node:path'
import { mkdir, stat } from 'node:fs/promises'
import { existsSync, createWriteStream, WriteStream } from 'node:fs'

import { defu } from 'defu'

import { uuidv7 } from '../../shared/utils/uuid'
import { froggerInternal } from '../../shared/utils/internal-log'

import { BaseMetricsTransport } from './base-metrics-transport'
import type { MetricObject } from '../shared/types/metric'
import type { FileOptions } from '../../shared/types/file'
import { DEFAULT_METRICS_FILE } from '../shared/utils/resolve-metrics'



export interface MetricsFileTransportOptions extends FileOptions { }

/**
 * Writes raw metric events as rotated JSON-lines. A retyped sibling of the log
 * `FileTransport`: identical streaming/rotation machinery, a distinct default
 * directory (`logs/metrics/`) so metric files never mingle with log files.
 */
export class MetricsFileTransport extends BaseMetricsTransport<Required<MetricsFileTransportOptions>> {
    public readonly name = 'FroggerMetricsFileTransport'
    public readonly transportId: string

    protected options: Required<MetricsFileTransportOptions>
    private currentFileName: string = ''
    private currentFileSize: number = 0
    private logBuffer: string[] = []
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private writeStream: WriteStream | null = null
    private writePromise: Promise<void> = Promise.resolve()
    private isRotating: boolean = false
    private bufferSize: number = 0

    constructor(options: FileOptions = {}) {
        super()
        this.transportId = `frogger-metrics-file-${uuidv7()}`

        this.options = defu(options, DEFAULT_METRICS_FILE) as Required<MetricsFileTransportOptions>

        this.ensureDirectoryExists().catch(err => {
            froggerInternal.error('Failed to create metrics directory:', err)
        })
    }

    async metric(metricObj: MetricObject): Promise<void> {
        try {
            const entry = this.formatEntry(metricObj)
            const entrySize = Buffer.byteLength(entry) + 1

            this.logBuffer.push(entry)
            this.bufferSize += entrySize

            this.scheduleFlush()

            if (this.bufferSize >= this.options.bufferMaxSize) {
                await this.flush()
            }
        }
        catch (err) {
            froggerInternal.error('Error adding metric to buffer:', err)
        }
    }

    override async metricBatch(metrics: MetricObject[]): Promise<void> {
        if (metrics.length === 0) return

        const entries = metrics.map(m => this.formatEntry(m))
        const content = entries.join('\n') + '\n'
        const contentSize = Buffer.byteLength(content)

        this.writePromise = this.writePromise.then(async () => {
            try {
                const fileName = this.getLogFileName()
                if (fileName !== this.currentFileName || !this.writeStream) {
                    await this.openNewStream(fileName)
                    this.currentFileName = fileName
                }

                if (this.currentFileSize + contentSize > this.options.maxSize && !this.isRotating) {
                    await this.rotateLogFile(fileName)
                    return this.writeToFile(content, contentSize)
                }

                return this.writeToFile(content, contentSize)
            }
            catch (err) {
                froggerInternal.error('Error writing metric batch to file:', err)
                throw err
            }
        })

        return this.writePromise
    }

    private async writeToFile(content: string, contentSize: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('No write stream available'))
            }
            const canContinue = this.writeStream.write(content, err => {
                if (err) return reject(err)
                this.currentFileSize += contentSize
            })

            if (canContinue) {
                resolve()
            }
            else {
                this.writeStream.once('drain', () => resolve())
            }
        })
    }

    private async openNewStream(fileName: string): Promise<void> {
        await this.closeCurrentStream()
        await this.ensureDirectoryExists()

        const filePath = join(this.options.directory, fileName)
        this.currentFileSize = await this.getFileSize(fileName)

        this.writeStream = createWriteStream(filePath, {
            flags: 'a',
            highWaterMark: this.options.highWaterMark,
        })

        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('Failed to create write stream'))
            }

            this.writeStream.on('error', (err) => {
                froggerInternal.error('Metrics write stream error:', err)
            })

            this.writeStream.on('open', () => resolve())
        })
    }

    private async closeCurrentStream(): Promise<void> {
        if (this.writeStream) {
            const stream = this.writeStream
            this.writeStream = null
            return new Promise((resolve) => {
                stream.end(() => resolve())
            })
        }
        return Promise.resolve()
    }

    private formatEntry(metricObj: MetricObject): string {
        return JSON.stringify(metricObj)
    }

    private getLogFileName(): string {
        const now = new Date()
        let fileName = this.options.fileNameFormat

        fileName = fileName
            .replace('YYYY', now.getFullYear().toString())
            .replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'))
            .replace('DD', now.getDate().toString().padStart(2, '0'))
            .replace('HH', now.getHours().toString().padStart(2, '0'))

        return fileName
    }

    private async getFileSize(fileName: string): Promise<number> {
        const filePath = join(this.options.directory, fileName)
        if (existsSync(filePath)) {
            const stats = await stat(filePath)
            return stats.size
        }
        return 0
    }

    private async rotateLogFile(fileName: string): Promise<void> {
        const filePath = join(this.options.directory, fileName)
        if (existsSync(filePath)) {
            const timestamp = Date.now()
            const rotatedFileName = fileName.replace(/\.log$/, `-${timestamp}.log`)
            const rotatedFilePath = join(this.options.directory, rotatedFileName)

            const fs = require('node:fs')
            fs.renameSync(filePath, rotatedFilePath)
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null
                this.flush().catch(err => {
                    froggerInternal.error('Error during scheduled metrics flush:', err)
                })
            }, this.options.flushInterval)
        }
    }

    override async flush(): Promise<void> {
        if (this.logBuffer.length === 0) return

        const toWrite = [...this.logBuffer]
        const bufferContent = toWrite.join('\n') + '\n'
        const bufferLength = this.bufferSize

        this.logBuffer = []
        this.bufferSize = 0

        this.writePromise = this.writePromise.then(async () => {
            try {
                const fileName = this.getLogFileName()
                if (fileName !== this.currentFileName || !this.writeStream) {
                    await this.openNewStream(fileName)
                    this.currentFileName = fileName
                }

                if (this.currentFileSize + bufferLength > this.options.maxSize && !this.isRotating) {
                    await this.rotateLogFile(fileName)
                    return this.writeToFile(bufferContent, bufferLength)
                }

                return this.writeToFile(bufferContent, bufferLength)
            }
            catch (err) {
                froggerInternal.error('Error writing metrics to file:', err)
                this.logBuffer = [...toWrite, ...this.logBuffer]
                this.bufferSize += bufferLength
                this.scheduleFlush()
                throw err
            }
        })

        return this.writePromise
    }

    override async forceFlush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }

        await this.flush()
        await this.closeCurrentStream()
    }

    private async ensureDirectoryExists(): Promise<void> {
        if (!existsSync(this.options.directory)) {
            try {
                await mkdir(this.options.directory, { recursive: true })
                froggerInternal.info(`Created metrics directory: ${this.options.directory}`)
            }
            catch (err) {
                froggerInternal.error(`Failed to create metrics directory ${this.options.directory}:`, err)
                throw err
            }
        }
    }
}
