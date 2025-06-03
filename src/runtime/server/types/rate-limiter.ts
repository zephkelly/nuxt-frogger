export interface RateLimitingOptions {
    /**
     * Rate limits per tier (requests per window)
     */
    limits: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    /**
     * Time windows in seconds
     */
    windows: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    /**
     * IP blocking configuration
     */
    blocking: {
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
    'X-Rate-Limit-Limit': string;
    'X-Rate-Limit-Remaining': string;
    'X-Rate-Limit-Reset': string;
    'X-Rate-Limit-Retry-After': string;
    'X-Frogger-Action': 'pause' | 'backoff' | 'block';
    'X-Frogger-Rate-Limit-Tier': string;
}


export interface IRateLimitStorage {
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttl?: number): Promise<number>;
}