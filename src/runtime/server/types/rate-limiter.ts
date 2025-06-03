export interface RateLimitingOptions {
    /**
     * Rate limits per tier (requests per window)
     */
    limits?: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    /**
     * Time windows in seconds
     */
    windows?: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    /**
     * IP blocking configuration
     */
    blocking?: {
        enabled: boolean;
        escalationResetHours: number;
        timeouts: number[];
    };

    /**
     * Storage configuration for rate limiting data
     */
    storage?: {
        driver?: string;
        options?: Record<string, any>;
    };
}

export interface RateLimitIdentifier {
    ip: string;
    reporterId?: string;
    appName?: string;
}

export interface RateLimitCheckResult {
    allowed: boolean;
    tier: 'global' | 'ip' | 'reporter' | 'app';
    limit: number;
    current: number;
    resetTime: number;
    retryAfter: number;
    
    isBlocked?: boolean;
    blockExpiresAt?: number;
    blockLevel?: number;
}

export interface RateLimitResponse {
    error: 'RATE_LIMIT_EXCEEDED' | 'IP_BLOCKED';
    message: string;
    retryAfter: number;
    action: 'pause' | 'backoff' | 'block';
    limit: number;
    current: number;
    resetTime: number;
    blockInfo?: {
        level: number;
        expiresAt: number;
    };
}

export interface RateLimitHeaders {
    'x-rate-limit-limit': string;
    'x-rate-limit-remaining': string;
    'x-rate-limit-reset': string;
    'x-rate-limit-retry-after': string;
    'x-frogger-action': 'pause' | 'backoff' | 'block';
    'x-frogger-rate-limit-tier': string;
}


export interface IRateLimitStorage {
    getStorageKey(): string;
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttl?: number): Promise<number>;
}