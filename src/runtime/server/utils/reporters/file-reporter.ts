import { mkdir, appendFile, stat } from 'node:fs/promises';
import { existsSync, createWriteStream, WriteStream } from 'node:fs';
import { join } from 'node:path';

import type { FileReporterOptions } from '../../types/file-reporter';

import type { LoggerObject } from '~/src/runtime/shared/types/log';


/**
 * Reporter that writes logs to local files
 */
export class FileReporter {
    private options: Required<FileReporterOptions>;
    private currentFileName: string = '';
    private currentFileSize: number = 0;
    private logBuffer: string[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private writeStream: WriteStream | null = null;
    private writePromise: Promise<void> = Promise.resolve();
    private isRotating: boolean = false;
    private bufferSize: number = 0;
    
    constructor(options: FileReporterOptions = {}) {
        this.options = {
            directory: options.directory || join(process.cwd(), 'logs'),
            fileNameFormat: options.fileNameFormat || 'YYYY-MM-DD.log',
            maxSize: options.maxSize || 10 * 1024 * 1024, // 10MB
            additionalFields: options.additionalFields || {},

            flushInterval: options.flushInterval || 1000,
            bufferMaxSize: options.bufferMaxSize || 1 * 1024 * 1024, // 1MB buffer
            highWaterMark: options.highWaterMark || 64 * 1024, // 64kb WriteStream buffer
        };
        
        this.ensureDirectoryExists().catch(err => {
            console.error('Failed to create log directory:', err);
        });
    }

    /**
     * Handle a log object and add it to the buffer
     */
    log(logObj: LoggerObject): void {
        try {
            const logEntry = this.formatLogEntry(logObj);
            const entrySize = Buffer.byteLength(logEntry) + 1; // +1 for newline
            
            this.logBuffer.push(logEntry);
            this.bufferSize += entrySize;
            
            this.scheduleFlush();
            
            if (this.bufferSize >= this.options.bufferMaxSize) {
                this.flush().catch(err => {
                    console.error('Error during immediate flush:', err);
                });
            }
        } catch (err) {
            console.error('Error adding log to buffer:', err);
        }
    }

    /**
     * Schedule a buffer flush
     */
    private scheduleFlush(): void {
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                this.flush().catch(err => {
                    console.error('Error during scheduled flush:', err);
                });
            }, this.options.flushInterval);
        }
    }

    /**
     * Flush the log buffer to disk
     */
    async flush(): Promise<void> {
        if (this.logBuffer.length === 0) {
            return;
        }

        const logsToWrite = [...this.logBuffer];
        const bufferContent = logsToWrite.join('\n') + '\n';
        const bufferLength = this.bufferSize;
        
        this.logBuffer = [];
        this.bufferSize = 0;
        
        this.writePromise = this.writePromise.then(async () => {
            try {
                const fileName = this.getLogFileName();
                if (fileName !== this.currentFileName || !this.writeStream) {
                    await this.openNewStream(fileName);
                    this.currentFileName = fileName;
                }
                
                if (this.currentFileSize + bufferLength > this.options.maxSize && !this.isRotating) {
                    await this.rotateLogFile(fileName);
                    return this.writeToFile(bufferContent, bufferLength);
                }
                
                return this.writeToFile(bufferContent, bufferLength);
            }
            catch (err) {
                console.error('Error writing logs to file:', err);
                this.logBuffer = [...logsToWrite, ...this.logBuffer];
                this.bufferSize += bufferLength;
                this.scheduleFlush();
                throw err;
            }
        });
        
        return this.writePromise;
    }

    /**
     * Write content to the current write stream
     */
    private async writeToFile(content: string, contentSize: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('No write stream available'));
            }
            
            const canContinue = this.writeStream.write(content, err => {
                if (err) {
                    return reject(err);
                }
                
                this.currentFileSize += contentSize;
            });
            
            if (canContinue) {
                resolve();
            }
            else {
                this.writeStream.once('drain', () => {
                    resolve();
                });
            }
        });
    }

    /**
     * Open a new write stream
     */
    private async openNewStream(fileName: string): Promise<void> {
        await this.closeCurrentStream();
        
        await this.ensureDirectoryExists();
        
        const filePath = join(this.options.directory, fileName);
        this.currentFileSize = await this.getFileSize(fileName);
        
        this.writeStream = createWriteStream(filePath, { 
            flags: 'a', 
            highWaterMark: this.options.highWaterMark
        });
        
        return new Promise((resolve, reject) => {
            if (!this.writeStream) {
                return reject(new Error('Failed to create write stream'));
            }
            
            this.writeStream.on('error', (err) => {
                console.error('Write stream error:', err);
            });
            
            this.writeStream.on('open', () => {
                resolve();
            });
        });
    }
    
    /**
     * Close the current write stream if open
     */
    private async closeCurrentStream(): Promise<void> {
        if (this.writeStream) {
            const stream = this.writeStream;
            this.writeStream = null;
            
            return new Promise((resolve) => {
                stream.end(() => {
                    resolve();
                });
            });
        }
        return Promise.resolve();
    }


    /**
     * Format a log entry based on configuration
     */
    private formatLogEntry(logObj: LoggerObject): string {
        const enrichedLog = {
            ...logObj,
            ...this.options.additionalFields,
        };
        

        return JSON.stringify(enrichedLog);
    }

    /**
     * Get the current log file name based on the format
     */
    private getLogFileName(): string {
        const now = new Date();
        let fileName = this.options.fileNameFormat;
        
        fileName = fileName
            .replace('YYYY', now.getFullYear().toString())
            .replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'))
            .replace('DD', now.getDate().toString().padStart(2, '0'))
            .replace('HH', now.getHours().toString().padStart(2, '0'));
        
        return fileName;
    }

    /**
     * Get the size of a file if it exists
     */
    private async getFileSize(fileName: string): Promise<number> {
        const filePath = join(this.options.directory, fileName);
        if (existsSync(filePath)) {
            const stats = await stat(filePath);
            return stats.size;
        }
        return 0;
    }

    /**
     * Rotate the log file when it exceeds the maximum size
     */
    private async rotateLogFile(fileName: string): Promise<void> {
        const filePath = join(this.options.directory, fileName);
        if (existsSync(filePath)) {
            const timestamp = Date.now();
            const rotatedFileName = fileName.replace(/\.log$/, `-${timestamp}.log`);
            const rotatedFilePath = join(this.options.directory, rotatedFileName);
            
            const fs = require('node:fs');
            fs.renameSync(filePath, rotatedFilePath);
        }
    }

    /**
     * Force flush any pending operations and close streams
     */
    async forceFlush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        
        await this.flush();
        await this.closeCurrentStream();
    }

    /**
     * Ensure the log directory exists
     */
    private async ensureDirectoryExists(): Promise<void> {
        if (!existsSync(this.options.directory)) {
            try {
                await mkdir(this.options.directory, { recursive: true });
                console.info(`Created log directory: ${this.options.directory}`);
            }
            catch (err) {
                console.error(`Failed to create log directory ${this.options.directory}:`, err);
                throw err;
            }
        }
    }
}