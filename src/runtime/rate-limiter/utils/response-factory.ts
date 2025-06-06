import type { RateLimitCheckResult, RateLimitHeaders, RateLimitResponse } from '../types/index';
import { formatSecondsDuration } from "../../shared/utils/seconds";



export class RateLimitResponseFactory {
    static createRateLimitError(result: RateLimitCheckResult): {
        statusCode: number;
        headers: RateLimitHeaders;
        body: RateLimitResponse
    } {
        const isBlocked = result.isBlocked || false;
        
        let action: 'pause' | 'backoff' | 'block';
        
        if (isBlocked) {
            action = 'block';
        } else if (result.tier === 'global') {
            action = 'pause';
        } else {
            action = 'backoff';
        }

        const timeRemaining = isBlocked && result.blockExpiresAt
            ? Math.max(0, Math.round((result.blockExpiresAt - Date.now()) / 1000))
            : result.retryAfter;

        const headers: RateLimitHeaders = {
            'x-rate-limit-limit': result.limit.toString(),
            'x-rate-limit-remaining': Math.max(0, result.limit - result.current).toString(),
            'x-rate-limit-reset': result.resetTime.toString(),
            'x-rate-limit-retry-after': timeRemaining.toString(),
            'x-frogger-action': action,
            'x-frogger-rate-limit-tier': result.tier
        }; 

        let errorType: 'RATE_LIMIT_EXCEEDED' | 'IP_BLOCKED';
        let message: string;

        if (isBlocked) {
            errorType = 'IP_BLOCKED';
            
            if (result.blockLevel !== undefined) {
                const tierNames = ['first', 'second', 'third', 'fourth', 'final'];
                const tierName = result.blockLevel < tierNames.length 
                    ? tierNames[result.blockLevel] 
                    : 'maximum';
                
                const hoursRemaining = result.blockExpiresAt 
                    ? Math.round((result.blockExpiresAt - Date.now()) / (1000 * 60 * 60) * 10) / 10
                    : 0;

                if (result.blockLevel >= 3) {
                    message = `IP address has been banned due to repeated violations. This is a ${tierName} level ban lasting ${hoursRemaining} hours.`;
                } else {
                    message = `IP address is temporarily blocked due to rate limit violations. This is a ${tierName} level block lasting ${hoursRemaining} hours.`;
                }
            } else {
                message = 'IP address is temporarily blocked due to rate limit violations.';
            }
        }
        else {
            errorType = 'RATE_LIMIT_EXCEEDED';
            
            switch (action) {
                case 'pause':
                    message = `Global rate limit exceeded. Please wait ${result.retryAfter} seconds before making additional requests.`;
                    break;
                case 'backoff':
                    message = `Rate limit exceeded for ${result.tier}. Please wait ${result.retryAfter} seconds before retrying.`;
                    break;
                default:
                    message = `Rate limit exceeded for ${result.tier}.`;
            }
        }

        const body: RateLimitResponse = {
            error: errorType,
            message,
            retryAfter: result.retryAfter,
            action: action,
            limit: result.limit,
            current: result.current,
            resetTime: result.resetTime
        };

        if (isBlocked && result.blockExpiresAt) {
            body.blockInfo = {
                level:  0,
                expiresAt: result.blockExpiresAt
            };
        }
        else if (action === 'backoff' && result.backoffLevel !== undefined) {
            body.backoffInfo = {
                tier: result.backoffLevel,
                escalationLevel: result.backoffLevel + 1 
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
            statusMessage: result.isBlocked ? 'IP Blocked' : 'Too Many Requests',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body
        };
    }

    static createUserMessage(result: RateLimitCheckResult): {
        title: string;
        message: string;
        severity: 'info' | 'warning' | 'error';
        canRetry: boolean;
        retryAfter?: number;
        phase?: 'backoff' | 'block';
    } {
        if (result.isBlocked) {
            const timeRemaining = result.blockExpiresAt 
                ? Math.max(0, Math.round((result.blockExpiresAt - Date.now()) / 1000))
                : result.retryAfter;

            const hoursRemaining = formatSecondsDuration(timeRemaining);

            if (result.blockLevel !== undefined && result.blockLevel >= 3) {
                return {
                    title: 'Account Temporarily Banned',
                    message: `Your IP address has been banned for ${hoursRemaining} hours due to repeated policy violations. Please contact support if you believe this is an error.`,
                    severity: 'error',
                    canRetry: false,
                    phase: 'block'
                };
            } else {
                return {
                    title: 'Temporarily Blocked',
                    message: `Your IP address has been temporarily blocked for ${hoursRemaining} hours. Please try again later.`,
                    severity: 'error',
                    canRetry: false,
                    phase: 'block'
                };
            }
        }
        else {
            const timeFormatted = formatSecondsDuration(result.retryAfter);
            const backoffTier = result.backoffLevel !== undefined ? result.backoffLevel + 1 : null;

            switch (result.tier) {
                case 'global':
                    return {
                        title: 'Server Busy',
                        message: `Our servers are experiencing high traffic. Please wait ${timeFormatted} before trying again.`,
                        severity: 'warning',
                        canRetry: true,
                        retryAfter: result.retryAfter,
                        phase: 'backoff'
                    };
                case 'ip':
                    const escalationText = backoffTier ? ` This is escalation level ${backoffTier}.` : '';
                    return {
                        title: 'Rate Limit Reached',
                        message: `You're making requests too quickly. Please wait ${timeFormatted} before trying again.${escalationText}`,
                        severity: backoffTier && backoffTier >= 3 ? 'error' : 'warning',
                        canRetry: true,
                        retryAfter: result.retryAfter,
                        phase: 'backoff'
                    };
                case 'app':
                    return {
                        title: 'App Limit Reached',
                        message: `This application has reached its rate limit. Please wait ${timeFormatted} before trying again.`,
                        severity: 'warning',
                        canRetry: true,
                        retryAfter: result.retryAfter,
                        phase: 'backoff'
                    };
                default:
                    return {
                        title: 'Request Limit Reached',
                        message: `Please wait ${timeFormatted} before making more requests.`,
                        severity: 'info',
                        canRetry: true,
                        retryAfter: result.retryAfter,
                        phase: 'backoff'
                    };
            }
        }
    }

    static createInfoHeaders(result: RateLimitCheckResult): Record<string, string> {
        const headers: Record<string, string> = {
            'x-rate-limit-limit': result.limit.toString(),
            'x-rate-limit-remaining': Math.max(0, result.limit - result.current).toString(),
            'x-rate-limit-reset': result.resetTime.toString(),
            'x-frogger-rate-limit-tier': result.tier
        };

        return headers;
    }

    static parseFromHeaders(headers: Record<string, string> | Headers): {
        limit: number;
        remaining: number;
        resetTime: number;
        retryAfter?: number;
        action?: string;
        tier?: string;
        isBlocked?: boolean;
        isBackoff?: boolean;
        backoffTier?: number;
        blockExpiresAt?: number;
    } {
        const getHeader = (key: string): string | undefined => {
            if (headers instanceof Headers) {
                return headers.get(key) || undefined;
            }
            return headers[key] || headers[key.toLowerCase()];
        };

        return {
            limit: parseInt(getHeader('x-rate-limit-limit') || '0'),
            remaining: parseInt(getHeader('x-rate-limit-remaining') || '0'),
            resetTime: parseInt(getHeader('x-rate-limit-reset') || '0'),
            retryAfter: getHeader('x-rate-limit-retry-after') 
                ? parseInt(getHeader('x-rate-limit-retry-after')!) 
                : undefined,
            action: getHeader('x-frogger-action'),
            tier: getHeader('x-frogger-rate-limit-tier'),
            isBlocked: getHeader('x-frogger-is-blocked') === 'true',
            isBackoff: getHeader('x-frogger-is-backoff') === 'true',
            backoffTier: getHeader('x-frogger-backoff-tier') 
                ? parseInt(getHeader('x-frogger-backoff-tier')!) 
                : undefined,
            blockExpiresAt: getHeader('x-frogger-block-expires-at') 
                ? parseInt(getHeader('x-frogger-block-expires-at')!) 
                : undefined
        };
    }
}