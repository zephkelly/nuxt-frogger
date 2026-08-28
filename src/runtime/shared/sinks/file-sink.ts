import { join } from 'node:path'
import { mkdir, stat, rename } from 'node:fs/promises'
import { existsSync, createWriteStream, WriteStream } from 'node:fs'

import type { FileOptions } from '../types/file'
import { froggerInternal } from '../utils/internal-log'

/**
 * Buffered, rotating JSON-lines file output for ANY record type.
 *
 * The log and metric file transports were a line-for-line retype of each other
 * - identical streaming, identical rotation, identical buffering, differing
 * only in the record type they serialise. That duplication was not theoretical:
 * the rotation bug that sent every line into a renamed file existed in BOTH
 * copies, because it had to be written twice and was only ever fixed once.
 *
 * Parameterised by record type rather than subclassed: the transports keep
 * their own identity and lifecycle and simply own one of these.
 */
export class FileSink<T> {
    private options: Required<FileOptions>
    private currentFileName: string = ''
    private currentFileSize: number = 0
    private buffer: string[] = []
    private bufferSize: number = 0
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private writeStream: WriteStream | null = null
    private writePromise: Promise<void> = Promise.resolve()

    /**
     * Set when the filesystem has told us writes cannot succeed (disk full,
     * read-only mount, no permission). Buffering into a sink that will never
     * drain grows until the process dies, so a degraded sink drops instead -
     * loudly, once.
     */
    private degraded: boolean = false

    constructor(
        options: Required<FileOptions>,
        private readonly label: string,
        private readonly serialize: (record: T) => string = record => JSON.stringify(record),
    ) {
        this.options = options

        this.ensureDirectoryExists().catch((err) => {
            froggerInternal.error(`${this.label}: failed to create directory:`, err)
        })
    }

    isDegraded(): boolean {
        return this.degraded
    }

    /** Buffer one record, flushing early once the buffer is large enough. */
    async add(record: T): Promise<void> {
        if (this.degraded) return

        try {
            const entry = this.serialize(record)
            this.buffer.push(entry)
            this.bufferSize += Buffer.byteLength(entry) + 1

            this.scheduleFlush()

            if (this.bufferSize >= this.options.bufferMaxSize) {
                await this.flush()
            }
        }
        catch (err) {
            froggerInternal.error(`${this.label}: failed to buffer a record:`, err)
        }
    }

    /** Write a batch straight through, bypassing the buffer. */
    async addBatch(records: T[]): Promise<void> {
        if (records.length === 0 || this.degraded) return

        const content = records.map(r => this.serialize(r)).join('\n') + '\n'
        const contentSize = Buffer.byteLength(content)

        this.writePromise = this.writePromise.then(async () => {
            try {
                await this.ensureStream()

                if (this.currentFileSize + contentSize > this.options.maxSize) {
                    await this.rotate(this.currentFileName)
                }

                return this.writeToFile(content, contentSize)
            }
            catch (err) {
                froggerInternal.error(`${this.label}: failed to write a batch:`, err)
                throw err
            }
        })

        return this.writePromise
    }

    /** Drain the buffer to disk. */
    async flush(): Promise<void> {
        if (this.buffer.length === 0 || this.degraded) return

        const pending = [...this.buffer]
        const content = pending.join('\n') + '\n'
        const length = this.bufferSize

        this.buffer = []
        this.bufferSize = 0

        this.writePromise = this.writePromise.then(async () => {
            try {
                await this.ensureStream()

                if (this.currentFileSize + length > this.options.maxSize) {
                    await this.rotate(this.currentFileName)
                }

                return this.writeToFile(content, length)
            }
            catch (err) {
                froggerInternal.error(`${this.label}: failed to write:`, err)

                // A degraded sink must not re-buffer: the retry can never
                // succeed and the buffer would grow without bound.
                if (!this.degraded) {
                    this.buffer = [...pending, ...this.buffer]
                    this.bufferSize += length
                    this.scheduleFlush()
                }
                throw err
            }
        })

        return this.writePromise
    }

    /** Shutdown drain: flush, wait for any in-flight write, then close. */
    async close(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }

        await this.flush().catch(() => {})
        // Waits for an in-flight rotation too, so a shutdown cannot race a
        // rotate and close the wrong stream.
        await this.writePromise.catch(() => {})
        await this.closeCurrentStream()
        this.currentFileName = ''
    }

    private async ensureStream(): Promise<void> {
        const fileName = this.fileNameForNow()

        if (fileName !== this.currentFileName || !this.writeStream) {
            await this.openNewStream(fileName)
            this.currentFileName = fileName
        }
    }

    /**
     * Roll the current file aside and start a fresh one.
     *
     * The stream MUST be closed before the rename and reopened after it: an
     * open descriptor follows the inode, so renaming underneath a live stream
     * sends every subsequent line into the rotated file while the newly-named
     * current file stays empty forever. Reopening also resets the size counter,
     * without which the size condition stays permanently true.
     *
     * The caller holds the `writePromise` chain, which is the real mutex here.
     */
    private async rotate(fileName: string): Promise<void> {
        const filePath = join(this.options.directory, fileName)

        await this.closeCurrentStream()

        if (existsSync(filePath) && this.currentFileSize > 0) {
            await rename(filePath, this.nextRotatedPath(fileName))
        }

        await this.openNewStream(fileName)
        this.currentFileName = fileName
        this.currentFileSize = 0
    }

    /**
     * A free rotated path. `Date.now()` alone collides at realistic write
     * rates, and `rename` overwrites its destination without complaint -
     * silently destroying a whole rotated file - so a disambiguating counter is
     * appended when the plain name is taken.
     */
    private nextRotatedPath(fileName: string): string {
        const timestamp = Date.now()
        let candidate = join(this.options.directory, fileName.replace(/\.log$/, `-${timestamp}.log`))

        for (let n = 1; existsSync(candidate); n++) {
            candidate = join(this.options.directory, fileName.replace(/\.log$/, `-${timestamp}-${n}.log`))
        }

        return candidate
    }

    private async writeToFile(content: string, contentSize: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('No write stream available'))
            }

            // Counted here, not in the write callback: the callback fires after
            // this promise has already resolved, so the size the rotation check
            // reads would always be one batch stale.
            this.currentFileSize += contentSize

            const canContinue = this.writeStream.write(content, (err) => {
                if (err) {
                    this.currentFileSize -= contentSize
                    return reject(err)
                }
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
        this.currentFileSize = await this.fileSize(fileName)

        this.writeStream = createWriteStream(filePath, {
            flags: 'a',
            highWaterMark: this.options.highWaterMark,
        })

        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('Failed to create write stream'))
            }

            this.writeStream.on('error', err => this.handleStreamError(err))
            this.writeStream.on('open', () => resolve())
        })
    }

    private async closeCurrentStream(): Promise<void> {
        if (!this.writeStream) return

        const stream = this.writeStream
        this.writeStream = null

        return new Promise(resolve => stream.end(() => resolve()))
    }

    /**
     * A stream error that means writes will keep failing degrades the sink
     * rather than being retried forever. Announced on the ungated channel,
     * because the alternative is losing everything from here on with no output.
     */
    private handleStreamError(err: NodeJS.ErrnoException): void {
        const fatal = err.code === 'ENOSPC' || err.code === 'EACCES'
            || err.code === 'EROFS' || err.code === 'EPERM'

        if (!fatal) {
            froggerInternal.error(`${this.label}: write stream error:`, err)
            return
        }

        this.degraded = true
        this.buffer = []
        this.bufferSize = 0

        froggerInternal.always.onceError(
            `file-sink-degraded:${this.label}:${this.options.directory}`,
            `${this.label} (${this.options.directory}) cannot write (${err.code}). `
            + `File output is disabled for this process; records are NOT being persisted to disk.`,
        )
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null) return

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            this.flush().catch((err) => {
                froggerInternal.error(`${this.label}: scheduled flush failed:`, err)
            })
        }, this.options.flushInterval)
    }

    private fileNameForNow(): string {
        const now = new Date()

        return this.options.fileNameFormat
            .replace('YYYY', now.getFullYear().toString())
            .replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'))
            .replace('DD', now.getDate().toString().padStart(2, '0'))
            .replace('HH', now.getHours().toString().padStart(2, '0'))
    }

    private async fileSize(fileName: string): Promise<number> {
        const filePath = join(this.options.directory, fileName)
        if (!existsSync(filePath)) return 0

        return (await stat(filePath)).size
    }

    private async ensureDirectoryExists(): Promise<void> {
        if (existsSync(this.options.directory)) return

        try {
            await mkdir(this.options.directory, { recursive: true })
            froggerInternal.info(`${this.label}: created directory ${this.options.directory}`)
        }
        catch (err) {
            froggerInternal.error(`${this.label}: failed to create directory ${this.options.directory}:`, err)
            throw err
        }
    }
}
