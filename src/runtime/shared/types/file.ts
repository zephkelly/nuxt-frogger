export interface FileOptions {
    directory?: string
    fileNameFormat?: string
    maxSize?: number
    flushInterval?: number
    bufferMaxSize?: number
    highWaterMark?: number
}

/**
 * Default file-logging options. Feeds both the `fileTransport()` entry
 * resolution and the imperative `new FileTransport()` fallback. Lives here (a
 * dependency-light module) so `FileTransport` can use it without importing the
 * full options resolver.
 */
export const DEFAULT_FILE: Required<FileOptions> = {
    directory: 'logs',
    fileNameFormat: 'YYYY-MM-DD.log',
    maxSize: 10 * 1024 * 1024,
    flushInterval: 1000,
    bufferMaxSize: 1 * 1024 * 1024,
    highWaterMark: 64 * 1024,
}