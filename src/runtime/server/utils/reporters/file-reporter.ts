import { mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { LogObject } from 'consola';

import type { FileReporterOptions } from '../../types/file-reporter';

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
            format: options.format || 'json',
            additionalFields: options.additionalFields || {},
        };

        // Ensure log directory exists on startup
        this.ensureDirectoryExists().catch(err => {
            console.error('Failed to create log directory:', err);
        });
    }

    /**
     * Handle a log object and write it to file
     */
    log(logObj: LogObject): void {
        // Queue the write operation to avoid concurrent writes
        this.writeQueue = this.writeQueue.then(() => this.writeLogToFile(logObj));
    }

    /**
     * Write a log entry to the current log file
     */
    private async writeLogToFile(logObj: LogObject): Promise<void> {
        try {
            const fileName = this.getLogFileName();
            
            // If file name changed, reset size tracking
            if (fileName !== this.currentFileName) {
                this.currentFileName = fileName;
                this.currentFileSize = 0;
                // We could check the actual file size here if needed
            }

            // Format the log entry based on configuration
            const logEntry = this.formatLogEntry(logObj);
            
            // Ensure the directory exists
            await this.ensureDirectoryExists();
            
            // Write to the file
            const filePath = join(this.options.directory, fileName);
            await appendFile(filePath, logEntry + '\n');
            
            // Update the file size tracking
            this.currentFileSize += logEntry.length + 1; // +1 for newline
            
            // TODO: If file exceeds maxSize, implement rotation logic
            // This could include renaming the current file and starting a new one
        }
        catch (error) {
            // Avoid crashing the application if logging fails
            console.error('Failed to write log to file:', error);
        }
    }

    /**
     * Format a log entry based on configuration
     */
    private formatLogEntry(logObj: LogObject): string {
        // Merge with additional fields
        const enrichedLog = {
            ...logObj,
            ...this.options.additionalFields,
        };

        const timestamp = new Date(logObj.date).toISOString();
        const level = logObj.type.toUpperCase().padEnd(5);
        const message = logObj.args.map(arg => 
            typeof arg === 'object' ? arg : String(arg)
        ).join(' ');
        
        return `[${timestamp}] ${level} ${message}`;
    }

    /**
     * Get the current log file name based on the format
     */
    private getLogFileName(): string {
        const now = new Date();
        let fileName = this.options.fileNameFormat;
        
        // Replace date tokens
        fileName = fileName
        .replace('YYYY', now.getFullYear().toString())
        .replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'))
        .replace('DD', now.getDate().toString().padStart(2, '0'))
        .replace('HH', now.getHours().toString().padStart(2, '0'));
        
        return fileName;
    }

    /**
     * Ensure the log directory exists
     */
    private async ensureDirectoryExists(): Promise<void> {
        if (!existsSync(this.options.directory)) {
            await mkdir(this.options.directory, { recursive: true });
        }
    }
}