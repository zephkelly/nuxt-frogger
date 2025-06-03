import type { RateLimitCheckResult, RateLimitHeaders, RateLimitResponse } from "../../types/rate-limiter";



export class RateLimitResponseFactory {
    static createRateLimitError(result: RateLimitCheckResult): { 
        statusCode: number; 
        headers: RateLimitHeaders; 
        body: RateLimitResponse 
    } {
        const isBlocked = result.isBlocked || false;
        
        const headers: RateLimitHeaders = {
            'X-Rate-Limit-Limit': result.limit.toString(),
            'X-Rate-Limit-Remaining': Math.max(0, result.limit - result.current).toString(),
            'X-Rate-Limit-Reset': result.resetTime.toString(),
            'X-Rate-Limit-Retry-After': result.retryAfter.toString(),
            'X-Frogger-Action': isBlocked ? 'block' : (result.tier === 'global' ? 'pause' : 'backoff'),
            'X-Frogger-Rate-Limit-Tier': result.tier
        };

        const body: RateLimitResponse = {
            error: isBlocked ? 'IP_BLOCKED' : 'RATE_LIMIT_EXCEEDED',
            message: isBlocked 
                ? `IP address is temporarily blocked (level ${result.blockLevel})` 
                : `Rate limit exceeded for ${result.tier}`,
            retryAfter: result.retryAfter,
            action: headers['X-Frogger-Action'],
            limit: result.limit,
            current: result.current,
            resetTime: result.resetTime
        };

        if (isBlocked && result.blockExpiresAt && result.blockLevel !== undefined) {
            body.blockInfo = {
                level: result.blockLevel,
                expiresAt: result.blockExpiresAt
            };
        }

        return {
            statusCode: 429,
            headers,
            body
        };
    }

    static createH3Response(result: RateLimitCheckResult) {
        const { statusCode, headers, body } = this.createRateLimitError(result);
        
        return {
            statusCode,
            statusMessage: 'Too Many Requests',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body
        };
    }
}