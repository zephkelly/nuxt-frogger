export interface HttpReporterOptions {
    endpoint: string;
    headers?: Record<string, string>;
    timeout?: number;
    retryOnFailure?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    appInfo?: {
        name: string;
        version: string;
    };
}