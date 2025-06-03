import { getHeader } from 'h3'

import type { RateLimitInfo, RateLimitStrategy } from '../types/info';



function getHeaderValue(headers: any, key: string): string | undefined {
    if (!headers) return undefined;
    
    if (typeof headers.get === 'function') {
        return headers.get(key) || undefined;
    }
    
    if (typeof headers === 'object') {
        if (headers[key] !== undefined) return headers[key];
        
        const lowerKey = key.toLowerCase();
        if (headers[lowerKey] !== undefined) return headers[lowerKey];
        
        const foundKey = Object.keys(headers).find(k => k.toLowerCase() === lowerKey);
        if (foundKey && headers[foundKey] !== undefined) return headers[foundKey];
    }
    
    return undefined;
}


export function parseRateLimitError(error: any): RateLimitInfo {
    const defaultInfo: RateLimitInfo = {
        isRateLimited: false,
        action: 'none',
        tier: 'unknown',
        limit: 0,
        remaining: 0,
        current: 0,
        resetTime: 0,
        retryAfter: 0,
        retryAfterMs: 0,
        shouldRetry: false,
        isBlocked: false,
        isPaused: false,
        isBackoff: false
    };

    if (!error?.response || error.response.status !== 429) {
        return defaultInfo;
    }

    const headers = error.response.headers || {};

    const limit = parseInt(getHeaderValue(headers, 'x-rate-limit-limit') || '0');
    const remaining = parseInt(getHeaderValue(headers, 'x-rate-limit-remaining') || '0');
    const resetTime = parseInt(getHeaderValue(headers, 'x-rate-limit-reset') || '0');
    const retryAfter = parseInt(
        getHeaderValue(headers, 'x-rate-limit-retry-after') || 
        getHeaderValue(headers, 'retry-after') || 
        '0'
    );
    const action = getHeaderValue(headers, 'x-frogger-action') || 'backoff';
    const tier = getHeaderValue(headers, 'x-frogger-rate-limit-tier') || 'unknown';

    const current = limit - remaining;
    const retryAfterMs = retryAfter * 1000;

    let blockInfo: { level: number; expiresAt: number } | undefined;
    if (error.response.data?.blockInfo) {
        blockInfo = {
            level: error.response.data.blockInfo.level,
            expiresAt: error.response.data.blockInfo.expiresAt
        };
    }

    const isBlocked = action === 'block';
    const isPaused = action === 'pause';
    const isBackoff = action === 'backoff';

    return {
        isRateLimited: true,
        action: action as 'block' | 'pause' | 'backoff',
        tier,
        limit,
        remaining,
        current,
        resetTime,
        retryAfter,
        retryAfterMs,
        blockInfo,
        shouldRetry: !isBlocked,
        isBlocked,
        isPaused,
        isBackoff
    };
}

export function getRateLimitStrategy(rateLimitInfo: RateLimitInfo, options: {
    maxRetries?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    respectServerTiming?: boolean;
} = {}): RateLimitStrategy {
    const {
        maxRetries = 5,
        baseBackoffMs = 1000,
        maxBackoffMs = 300000,
        respectServerTiming = true
    } = options;

    switch (rateLimitInfo.action) {
        case 'block':
            return {
                shouldRetry: false,
                delayMs: rateLimitInfo.retryAfterMs,
                dropRequest: true,
                message: `IP blocked (level ${rateLimitInfo.blockInfo?.level || 'unknown'}) until ${new Date(rateLimitInfo.blockInfo?.expiresAt || rateLimitInfo.resetTime).toISOString()}`
            };

        case 'pause':
            const pauseDelay = respectServerTiming 
                ? rateLimitInfo.retryAfterMs 
                : Math.min(rateLimitInfo.retryAfterMs || 60000, maxBackoffMs);
            
            return {
                shouldRetry: true,
                delayMs: pauseDelay,
                maxRetries: Math.min(maxRetries, 3),
                message: `Global rate limit reached. Pausing for ${Math.round(pauseDelay / 1000)}s. ${rateLimitInfo.current}/${rateLimitInfo.limit} requests in window.`
            };

        case 'backoff':
        default:
            const backoffDelay = respectServerTiming 
                ? rateLimitInfo.retryAfterMs 
                : Math.min(rateLimitInfo.retryAfterMs || baseBackoffMs, maxBackoffMs);

            return {
                shouldRetry: true,
                delayMs: backoffDelay,
                maxRetries,
                message: `Rate limit exceeded for ${rateLimitInfo.tier}. Backing off for ${Math.round(backoffDelay / 1000)}s. ${rateLimitInfo.current}/${rateLimitInfo.limit} requests in window.`
            };
    }
}

export function handleRateLimit(error: any, options: {
    maxRetries?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    respectServerTiming?: boolean;
    onRateLimit?: (info: RateLimitInfo, strategy: RateLimitStrategy, attempt?: number) => void;
} = {}): {
    rateLimitInfo: RateLimitInfo;
    strategy: RateLimitStrategy;
    shouldRetry: boolean;
    delayMs: number;
} {
    const rateLimitInfo = parseRateLimitError(error);
    const strategy = getRateLimitStrategy(rateLimitInfo, options);

    if (options.onRateLimit && rateLimitInfo.isRateLimited) {
        options.onRateLimit(rateLimitInfo, strategy);
    }

    return {
        rateLimitInfo,
        strategy,
        shouldRetry: strategy.shouldRetry && !strategy.dropRequest,
        delayMs: strategy.delayMs
    };
}