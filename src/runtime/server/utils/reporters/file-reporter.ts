import { mkdir, appendFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { FileReporterOptions } from '../../types/file-reporter';

import type { LoggerObject } from '~/src/runtime/shared/types';


/**
 * Reporter that writes logs to local files
 */
export class FileReporter {
    private options: Required<FileReporterOptions>;
    private currentFileName: string = '';
    private currentFileSize: number = 0;
    private writeQueue: Promise<void> = Promise.resolve();
    
    constructor(options: FileReporterOptions = {}) {
        this.options = {
            directory: options.directory || join(process.cwd(), 'logs'),
            fileNameFormat: options.fileNameFormat || 'YYYY-MM-DD.log',
            maxSize: options.maxSize || 10 * 1024 * 1024, // 10MB
            additionalFields: options.additionalFields || {},
        };
        
        this.ensureDirectoryExists().catch(err => {
            console.error('Failed to create log directory:', err);
        });
    }

    /**
     * Handle a log object and write it to file
     */
    log(logObj: LoggerObject): void {
        this.writeQueue = this.writeQueue
            .then(() => this.processLogEntry(logObj))
            .catch(err => {
                console.error('Error in file reporter write queue:', err);
                return Promise.resolve();
            });
    }

    /**
     * Process a log entry - handles both individual logs and batched logs
     */
    private async processLogEntry(logObj: LoggerObject): Promise<void> {
        if (logObj && typeof logObj === 'object' && 'logs' in logObj && Array.isArray(logObj.logs)) {
            const { logs, ...metadata } = logObj;
            
            for (const individualLog of logs) {
                await this.writeLogToFile(individualLog);
            }
        } else {
            await this.writeLogToFile(logObj);
        }
    }

    /**
     * Force flush any pending operations
     */
    async flush(): Promise<void> {
        await this.writeQueue;
    }

    /**
     * Write a log entry to the current log file
     */
    private async writeLogToFile(logObj: LoggerObject): Promise<void> {
        try {
            const fileName = this.getLogFileName();
            if (fileName !== this.currentFileName) {
                this.currentFileName = fileName;
                this.currentFileSize = await this.getFileSize(fileName);
            }
            
            const logEntry = this.formatLogEntry(logObj);
            
            await this.ensureDirectoryExists();
            
            if (this.currentFileSize > this.options.maxSize) {
                await this.rotateLogFile(fileName);
                this.currentFileSize = 0;
            }
            
            const filePath = join(this.options.directory, fileName);
            await appendFile(filePath, logEntry + '\n');
            
            this.currentFileSize += Buffer.byteLength(logEntry) + 1;
        }
        catch (error) {
            console.error('Failed to write log to file:', error);
            throw error;
        }
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