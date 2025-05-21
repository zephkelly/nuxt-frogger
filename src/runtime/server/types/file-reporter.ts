export interface FileReporterOptions {
    /**
     * Directory to store log files
     * @default process.cwd() + '/logs'
     */
    directory?: string;

    /**
     * Log file name format. Supports date tokens:
     * - YYYY: Year (4 digits)
     * - MM: Month (2 digits)
     * - DD: Day (2 digits)
     * - HH: Hour (2 digits)
     * @default 'YYYY-MM-DD.log'
     */
    fileNameFormat?: string;
    
    /**
     * Additional fields to include in log entries
    */
   additionalFields?: Record<string, any>;


    /**
    * Maximum log file size in bytes before rotating
    * @default 10485760 (10MB)
    */
    maxSize?: number;

    /**
     * Interval in milliseconds to flush the log buffer to disk
     * @default 1000 (1 second)
     */
    flushInterval?: number;
    
    /**
     * Maximum size of the in-memory buffer before forced flush (in bytes)
     * @default 1048576 (1MB)
     */
    bufferMaxSize?: number;
    
    /**
     * Buffer size for the write stream (in bytes)
     * @default 65536 (64KB)
     */
    highWaterMark?: number;
}