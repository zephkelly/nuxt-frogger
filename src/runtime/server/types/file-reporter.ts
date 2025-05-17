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
     * Maximum log file size in bytes before rotating
     * @default 10485760 (10MB)
     */
    maxSize?: number;

    /**
     * Format for log output
     * - 'json': JSON format (one object per line)
     * - 'text': Human-readable text format
     * @default 'json'
     */
    format?: 'json' | 'text';

    /**
     * Additional fields to include in log entries
     */
    additionalFields?: Record<string, any>;
}