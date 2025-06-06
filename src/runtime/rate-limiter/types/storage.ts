export interface IRateLimitStorage {
    getStorageKey(): string;
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttl?: number): Promise<number>;
}