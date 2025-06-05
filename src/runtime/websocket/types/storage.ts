export interface StorageInterfaceOptions {
    type: 'file';
    cache?: CacheOptions;
}

export interface CacheOptions {
    maxMemoryMB?: number;
    ttlSeconds?: number;
    maxEntries?: number;
    enabled?: boolean;
}