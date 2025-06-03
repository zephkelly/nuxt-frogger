interface RateLimitInfo {
    isRateLimited: boolean;
    action: 'block' | 'pause' | 'backoff' | 'none';
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

interface RateLimitStrategy {
    shouldRetry: boolean;
    delayMs: number;
    maxRetries?: number;
    dropRequest?: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    message: string;
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
    
    const limit = parseInt(headers['x-rate-limit'] || '0');
    const remaining = parseInt(headers['x-rate-limit-remaining'] || '0');
    const resetTime = parseInt(headers['x-rate-limit-reset'] || '0');
    const retryAfter = parseInt(headers['x-rate-limit-retry-after'] || headers['retry-after'] || '0');
    const action = headers['x-frogger-action'] || 'backoff';
    const tier = headers['x-frogger-rate-limit-tier'] || 'unknown';

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

    if (!rateLimitInfo.isRateLimited) {
        return {
        shouldRetry: false,
        delayMs: 0,
        logLevel: 'debug',
        message: 'No rate limiting detected'
        };
    }

    switch (rateLimitInfo.action) {
        case 'block':
            return {
                shouldRetry: false,
                delayMs: rateLimitInfo.retryAfterMs,
                dropRequest: true,
                logLevel: 'error',
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
                logLevel: 'warn',
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
                logLevel: 'warn',
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

    console.log(`Rate Limit Info:`, rateLimitInfo);
    console.log(`Rate Limit Strategy:`, strategy);

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


export function createRateLimitDelay(delayMs: number): Promise<void> {
    if (delayMs <= 0) return Promise.resolve();
    
    return new Promise(resolve => {
        setTimeout(resolve, delayMs);
    });
}


export async function fetchWithRateLimit<T = any>(
    url: string, 
    options: any = {}, 
    rateLimitOptions: {
        maxRetries?: number;
        baseBackoffMs?: number;
        maxBackoffMs?: number;
        respectServerTiming?: boolean;
        onRateLimit?: (info: RateLimitInfo, strategy: RateLimitStrategy, attempt?: number) => void;
    } = {}
): Promise<T> {
    const maxRetries = rateLimitOptions.maxRetries || 5;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            return await $fetch<T>(url, options);
        }
        catch (error: any) {
            const { rateLimitInfo, strategy, shouldRetry, delayMs } = handleRateLimit(error, rateLimitOptions);

            if (!rateLimitInfo.isRateLimited) {
                throw error;
            }

            if (rateLimitOptions.onRateLimit) {
                rateLimitOptions.onRateLimit(rateLimitInfo, strategy, attempt + 1);
            }

            if (!shouldRetry || attempt >= maxRetries) {
                console[strategy.logLevel](strategy.message);
                throw error;
            }

            console[strategy.logLevel](`${strategy.message} (attempt ${attempt + 1}/${maxRetries})`);
            
            if (delayMs > 0) {
                await createRateLimitDelay(delayMs);
            }

            attempt++;
        }
    }

    throw new Error('Max retries exceeded');
}

export function isRateLimitExpired(resetTime: number): boolean {
    return Date.now() >= resetTime;
}


export function getTimeUntilReset(resetTime: number): number {
    return Math.max(0, resetTime - Date.now());
}