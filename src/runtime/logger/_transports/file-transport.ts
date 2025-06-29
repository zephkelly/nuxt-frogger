import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync, createWriteStream, WriteStream } from 'node:fs';

import { useRuntimeConfig } from '#imports';
import { uuidv7 } from '../../shared/utils/uuid';

import { BaseTransport } from './base-transport';

import type { LoggerObject } from '~/src/runtime/shared/types/log';
import type { FileOptions } from "../../shared/types/file";



export interface FileTransportOptions extends FileOptions { }

/**
 * Transport that writes logs to local files
 */
export class FileTransport extends BaseTransport<Required<FileTransportOptions>> {
    public readonly name = 'FroggerFileTransport';
    public readonly transportId: string;

    protected options: Required<FileTransportOptions>;
    private currentFileName: string = '';
    private currentFileSize: number = 0;
    private logBuffer: string[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private writeStream: WriteStream | null = null;
    private writePromise: Promise<void> = Promise.resolve();
    private isRotating: boolean = false;
    private bufferSize: number = 0;
    
    constructor() {
        super();
        this.transportId = `frogger-file-${uuidv7()}`;
        const config = useRuntimeConfig()

        this.options = config.frogger.file

        this.ensureDirectoryExists().catch(err => {
            console.error('Failed to create log directory:', err);
        });
    }

    async log(logObj: LoggerObject): Promise<void> {
        try {
            const logEntry = this.formatLogEntry(logObj);
            const entrySize = Buffer.byteLength(logEntry) + 1;
            
            this.logBuffer.push(logEntry);
            this.bufferSize += entrySize;
            
            this.scheduleFlush();
            
            if (this.bufferSize >= this.options.bufferMaxSize) {
                await this.flush();
            }
        }
        catch (err) {
            console.error('Error adding log to buffer:', err);
        }
    }

    /**
     * Write a batch of logs directly to file (bypasses internal buffer)
     * Used by BatchReporter to write pre-sorted logs
     */
    override async logBatch(logs: LoggerObject[]): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        const logEntries = logs.map(log => this.formatLogEntry(log));
        const content = logEntries.join('\n') + '\n';
        const contentSize = Buffer.byteLength(content);

        this.writePromise = this.writePromise.then(async () => {
            try {
                const fileName = this.getLogFileName();
                if (fileName !== this.currentFileName || !this.writeStream) {
                    await this.openNewStream(fileName);
                    this.currentFileName = fileName;
                }
                
                if (this.currentFileSize + contentSize > this.options.maxSize && !this.isRotating) {
                    await this.rotateLogFile(fileName);
                    return this.writeToFile(content, contentSize);
                }
                
                return this.writeToFile(content, contentSize);
            }
            catch (err) {
                console.error('Error writing batch to file:', err);
                throw err;
            }
        });
        
        return this.writePromise;
    }

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


    private formatLogEntry(logObj: LoggerObject): string {
        const enrichedLog = {
            ...logObj,
        };
        

        return JSON.stringify(enrichedLog);
    }

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

    private async getFileSize(fileName: string): Promise<number> {
        const filePath = join(this.options.directory, fileName);
        if (existsSync(filePath)) {
            const stats = await stat(filePath);
            return stats.size;
        }
        return 0;
    }

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

    override async flush(): Promise<void> {
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

    override async forceFlush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        
        await this.flush();
        await this.closeCurrentStream();
    }

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