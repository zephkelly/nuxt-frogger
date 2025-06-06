export interface RateLimitIdentifier {
    ip: string;
    reporterId?: string;
    appName?: string;
}

export type RateLimitScope = 'global' | 'ip' | 'reporter' | 'app'

export type RateLimitAction = 'pause' | 'backoff' | 'block' | 'none'

export interface RateLimitCheckResult {
    allowed: boolean;
    tier: RateLimitScope;
    limit: number;
    current: number;
    resetTime: number;
    retryAfter: number;
    
    backoffLevel?: number;
    isBlocked?: boolean;
    blockExpiresAt?: number;
    blockLevel?: number;
}

export interface RateLimitResponse {
    error: 'RATE_LIMIT_EXCEEDED' | 'IP_BLOCKED';
    message: string;
    retryAfter: number;
    action: RateLimitAction;
    limit: number;
    current: number;
    resetTime: number;
    backoffInfo?: {
        tier: number;
        escalationLevel: number;
    };
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
    'x-frogger-action': RateLimitAction;
    'x-frogger-rate-limit-tier': string;
}


export {
    type IRateLimitStorage
} from './storage'

export {
    type RateLimitingOptions
} from './options'

export {
    type ViolationRecord
} from './violation'