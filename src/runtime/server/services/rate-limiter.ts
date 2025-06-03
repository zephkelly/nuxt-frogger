import { H3Event, createError, setResponseHeaders } from 'h3'

//@ts-ignore
import { useRuntimeConfig } from '#imports'

import type {
    IRateLimitStorage,
    RateLimitingOptions,
    RateLimitIdentifier,
    RateLimitCheckResult
} from "../types/rate-limiter"

import type { RateLimitScope } from '../../shared/types/rate-limit'

import { RateLimitKVLayer } from "../utils/rate-limit/kv-layer"
import { RateLimitResponseFactory } from '../utils/rate-limit/response-factory';
import { extractRateLimitIdentifier } from '../services/rate-limiter';



export class SlidingWindowRateLimiter {
    private static instance: SlidingWindowRateLimiter | null = null
    private storage: IRateLimitStorage
    private config: RateLimitingOptions
    private isEnabled: boolean

    constructor() {
        const runtimeConfig = useRuntimeConfig()
        //@ts-ignore
        const rateLimiterConfig = runtimeConfig.frogger?.rateLimiter

        this.isEnabled = rateLimiterConfig !== false

        if (!this.isEnabled) {
            this.storage = undefined as unknown as IRateLimitStorage
            this.config = {} as RateLimitingOptions
            return
        }

        this.storage = new RateLimitKVLayer('frogger-rate-limiter')

        this.config = {
            limits: {
                global: rateLimiterConfig.limits?.global,
                perIp: rateLimiterConfig.limits?.perIp || 100,
                perReporter: rateLimiterConfig.limits?.perReporter,
                perApp: rateLimiterConfig.limits?.perApp
            },
            windows: {
                global: rateLimiterConfig.windows?.global,
                perIp: rateLimiterConfig.windows?.perIp || 60,
                perReporter: rateLimiterConfig.windows?.perReporter,
                perApp: rateLimiterConfig.windows?.perApp
            },
            blocking: {
                enabled: rateLimiterConfig.blocking?.enabled ?? true,
                escalationResetHours: rateLimiterConfig.blocking?.escalationResetHours || 24,
                timeouts: rateLimiterConfig.blocking?.timeouts || [60, 300, 1800]
            }
        }

        setInterval(async () => {
            try {
                await this.cleanup()
            }
            catch (error) {
                console.error('Failed to cleanup expired rate limit keys:', error)
            }
        }, 5 * 60 * 1000)
    }

    public static getInstance(): SlidingWindowRateLimiter {
        if (!SlidingWindowRateLimiter.instance) {
            SlidingWindowRateLimiter.instance = new SlidingWindowRateLimiter()
        }
        return SlidingWindowRateLimiter.instance
    }

    static resetInstance(): void {
        SlidingWindowRateLimiter.instance = null
    }

    isRateLimitingEnabled(): boolean {
        return this.isEnabled
    }

    getChecks(identifier: RateLimitIdentifier): { tier: RateLimitScope; key?: string; limit?: number; window?: number }[] {
        return [
            { tier: 'global', key: 'global', limit: this.config.limits?.global, window: this.config.windows?.global },
            { tier: 'ip', key: identifier.ip, limit: this.config.limits?.perIp, window: this.config.windows?.perIp },
            { tier: 'reporter', key: identifier.reporterId, limit: this.config.limits?.perReporter, window: this.config.windows?.perReporter }, 
            { tier: 'app', key: identifier.appName, limit: this.config.limits?.perApp, window: this.config.windows?.perApp }
        ]
    }

    async checkRateLimit(identifier: RateLimitIdentifier): Promise<RateLimitCheckResult[] | null> {
        if (!this.isEnabled) {
            return null
        }

        const now = Date.now()

        const blockResult = await this.checkIPBlock(identifier.ip)
        if (blockResult.isBlocked) {
            return [blockResult]
        }

        const checks = this.getChecks(identifier)

        const results: RateLimitCheckResult[] = []

        for (const check of checks) {
            if (!check.key || !check.limit || check.limit <= 0 || !check.window || check.window <= 0) continue

            const result = await this.checkSlidingWindow(
                check.key,
                check.tier,
                check.limit,
                check.window,
                now
            )

            results.push(result)
            
            console.log(`Rate limit check for ${check.tier}:${check.key} - Allowed: ${result.allowed}, Current: ${result.current}/${result.limit}`)
            
            if (!result.allowed) {
                return [result]
            }
        }

        await this.recordRequest(identifier, now)

        return results
    }

    private async checkSlidingWindow(
        key: string,
        tier: RateLimitScope,
        limit: number,
        windowSeconds: number,
        now: number
    ): Promise<RateLimitCheckResult> {
        const windowKey = `rate_limit:${tier}:${key}`
        const windowMs = windowSeconds * 1000
        const windowStart = now - windowMs

        let windowData = await this.storage.get<number[]>(windowKey) || []

        if (windowData.length > limit * 5) {
            console.warn(`Rate limiter array for ${tier}:${key} is too large (${windowData.length}), trimming...`)
            windowData = windowData
                .filter(timestamp => timestamp > windowStart)
                .sort((a, b) => b - a)
                .slice(0, limit * 2)
            
            await this.storage.set(windowKey, windowData, windowSeconds + 60)
        }

        const validTimestamps = windowData.filter(timestamp => timestamp > windowStart).slice(0, Math.max(limit * 2, 1000))
        
        const current = validTimestamps.length
        const allowed = current < limit
        
        const oldestRequest = validTimestamps.length > 0 
            ? validTimestamps.reduce((min, timestamp) => Math.min(min, timestamp), validTimestamps[0])
            : null

        const resetTime = oldestRequest ? oldestRequest + windowMs : now + windowMs
        const retryAfter = allowed ? 0 : Math.ceil((resetTime - now) / 1000)

        return {
            allowed,
            tier,
            limit,
            current,
            resetTime,
            retryAfter
        }
    }

    private async recordRequest(identifier: RateLimitIdentifier, timestamp: number): Promise<void> {
        if (!this.isEnabled) {
            return
        }

        const keys = this.getChecks(identifier)

        const relevantLimit = this.config.limits?.perReporter || this.config.limits?.perIp || this.config.limits?.global || 1000
        const maxLimit = Math.min(relevantLimit * 2, 500)

        const promises = keys
            .filter(item => item.key && item.window && item.window > 0 && maxLimit && maxLimit > 0)
            .map(async (item) => {
                const windowKey = `rate_limit:${item.tier}:${item.key}`
                const windowMs = item.window! * 1000
                const windowStart = timestamp - windowMs

                let windowData = await this.storage.get<number[]>(windowKey) || []

                windowData = windowData.filter(ts => ts > windowStart)
                
                if (windowData.length >= maxLimit) {
                    windowData = windowData
                        .sort((a, b) => b - a)
                        .slice(0, maxLimit - 1)
                }
                
                const updatedData = [...windowData, timestamp]
                    .sort((a, b) => b - a)
                    .slice(0, maxLimit)

                await this.storage.set(windowKey, updatedData, item.window! + 60)
            })

        await Promise.all(promises)
    }

    private async checkIPBlock(ip: string): Promise<RateLimitCheckResult> {
        if (!this.config.blocking?.enabled) {
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 }
        }

        const blockKey = `ip_block:${ip}`
        const blockData = await this.storage.get<{
            level: number
            expiresAt: number
            violations: number
            lastViolation: number
        }>(blockKey)

        if (!blockData) {
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 }
        }

        const now = Date.now()

        if (blockData.expiresAt <= now) {
            await this.storage.delete(blockKey)
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 }
        }

        const retryAfter = Math.ceil((blockData.expiresAt - now) / 1000)

        return {
            allowed: false,
            tier: 'ip',
            limit: 0,
            current: 0,
            resetTime: blockData.expiresAt,
            retryAfter,
            isBlocked: true,
            blockExpiresAt: blockData.expiresAt,
            blockLevel: blockData.level
        }
    }

    async blockIP(ip: string): Promise<void> {
        if (!this.isEnabled || !this.config.blocking?.enabled) return

        const blockKey = `ip_block:${ip}`
        const now = Date.now()
        
        const existingBlock = await this.storage.get<{
            level: number
            expiresAt: number
            violations: number
            lastViolation: number
        }>(blockKey)

        let level = 0
        let violations = 1

        if (existingBlock) {
            const hoursSinceLastViolation = (now - existingBlock.lastViolation) / (1000 * 60 * 60)
            
            if (hoursSinceLastViolation < this.config.blocking.escalationResetHours) {
                level = Math.min(existingBlock.level + 1, this.config.blocking.timeouts.length - 1)
                violations = existingBlock.violations + 1
            }
            else {
                level = 0
                violations = 1
            }
        }

        const timeoutSeconds = this.config.blocking.timeouts[level]
        const expiresAt = now + (timeoutSeconds * 1000)

        await this.storage.set(blockKey, {
            level,
            expiresAt,
            violations,
            lastViolation: now
        }, timeoutSeconds + 3600)
    }

    async clearIPBlock(ip: string): Promise<void> {
        if (!this.isEnabled) return
        
        const blockKey = `ip_block:${ip}`
        await this.storage.delete(blockKey)
    }

    async getStats(identifier: RateLimitIdentifier): Promise<Record<string, { current: number; limit: number; resetTime: number }> | null> {
        if (!this.isEnabled) return null

        const now = Date.now()
        const stats: Record<string, { current: number; limit: number; resetTime: number }> = {}

        const checks = this.getChecks(identifier)

        for (const check of checks) {
            if (!check.limit || !check.window || !check.key) continue

            const windowKey = `rate_limit:${check.tier}:${check.key}`
            const windowMs = check.window * 1000
            const windowStart = now - windowMs

            const windowData = await this.storage.get<number[]>(windowKey) || []
            const validTimestamps = windowData.filter(timestamp => timestamp > windowStart)
            const current = windowData.filter(timestamp => timestamp > windowStart).length
            const oldestRequest = validTimestamps.length > 0 
                ? validTimestamps.reduce((min, timestamp) => Math.min(min, timestamp), validTimestamps[0])
                : null

            const resetTime = oldestRequest ? oldestRequest + windowMs : now + windowMs

            stats[check.tier] = {
                current,
                limit: check.limit,
                resetTime
            }
        }

        return stats
    }

    async check(event: H3Event): Promise<void> {
        if (this.isRateLimitingEnabled()) {
            const identifier = extractRateLimitIdentifier(event);
            const rateLimitResults = await this.checkRateLimit(identifier);

            const ipResult = rateLimitResults?.find(result => result.tier === 'ip');
            const firstResult = ipResult || rateLimitResults?.[0];

            if (firstResult && !firstResult.allowed) {
                console.warn(
                    '%cFROGGER RATE LIMIT', 
                    'color: white; background-color: #f59e0b; font-weight: bold; font-size: 1.1rem;',
                    `⚠️ Rate limit exceeded for ${identifier.ip} (${firstResult.tier} tier): ${firstResult.current}/${firstResult.limit}`
                );

                if (!firstResult.isBlocked) {
                    await this.blockIP(identifier.ip);
                    console.warn(
                        '%cFROGGER IP BLOCKED', 
                        'color: white; background-color: #dc2626; font-weight: bold; font-size: 1.2rem;',
                        `🚨 IP ${identifier.ip} has been blocked due to rate limit violations`
                    );
                }
                
                const response = RateLimitResponseFactory.createH3Response(firstResult);
                setResponseHeaders(event, response.headers);
                throw createError(response);
            }
            else if (firstResult && firstResult.allowed) {
                console.log(firstResult)
                console.log(`🚨 IP ${identifier.ip} request this window: ${firstResult.current}/${firstResult.limit}`)
            }

            if (import.meta.dev) {
                console.debug(`Rate limit check passed for ${identifier.ip}: ${firstResult?.current || 0} requests`);
            }
        }
    }

    async cleanup(): Promise<void> {
        if (!this.isEnabled) return

        try {
            const keys = await this.storage.get(`${this.storage.getStorageKey()}:keys`) || []

            const chunkSize = 50
            for (let i = 0; i < keys.length; i += chunkSize) {
                const chunk = keys.slice(i, i + chunkSize)
                
                const cleanupPromises = chunk.map(async (key: string) => {
                    try {
                        const value = await this.storage.get(key)
                        if (value && typeof value === 'object' && 'expiresAt' in value) {
                            const wrapped = value as { data: any; expiresAt: number }
                            if (Date.now() > wrapped.expiresAt) {
                                const cleanKey = key.startsWith(`${this.storage.getStorageKey()}:`) 
                                    ? key.replace(`${this.storage.getStorageKey()}:`, '') 
                                    : key
                                await this.storage.delete(cleanKey)
                            }
                        }
                    } catch (error) {
                        console.error(`Failed to cleanup key ${key}:`, error)
                    }
                })
                
                await Promise.all(cleanupPromises)
            }
        }
        catch (error) {
            console.error('Failed to cleanup expired rate limit keys:', error)
        }
    }
}

export function getFroggerRateLimiter(): SlidingWindowRateLimiter {
    const rateLimiter = SlidingWindowRateLimiter.getInstance()

    try {

    }
    finally {
        return rateLimiter
    }
}

export { extractRateLimitIdentifier } from '../utils/rate-limit/extract-identifier'