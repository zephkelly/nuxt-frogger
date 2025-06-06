import type { RateLimitAction } from ".";


export interface RateLimitInfo {
    isRateLimited: boolean;
    action: RateLimitAction;
    tier: string;
    limit: number;
    remaining: number;
    current: number;
    resetTime: number;
    retryAfter: number;
    retryAfterMs: number;
    blockInfo?: {
        level: number;
        expiresAt: number;
    };
    shouldRetry: boolean;
    isBlocked: boolean;
    isPaused: boolean;
    isBackoff: boolean;
}

export interface RateLimitStrategy {
    shouldRetry: boolean;
    delayMs: number;
    maxRetries?: number;
    dropRequest?: boolean;
    message: string;
}