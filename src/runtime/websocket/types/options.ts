export interface CacheOptions {
    maxMemoryMB?: number;
    ttlSeconds?: number;
    maxEntries?: number;
    enabled?: boolean;
}


export interface WebsocketOptions {
    route: string;
    defaultChannel?: string;

    upgrade?: (request: Request) => boolean | Promise<boolean>;

    maxConcurrentQueries?: number;
    defaultQueryTimeout?: number;
    maxQueryResults?: number;

    cache?: CacheOptions;
}