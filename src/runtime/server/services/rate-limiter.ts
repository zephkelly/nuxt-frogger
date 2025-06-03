//@ts-ignore
import { useRuntimeConfig, useStorage } from '#imports'

import type {
    IRateLimitStorage,
    RateLimitingOptions,
    RateLimitIdentifier,
    RateLimitCheckResult
} from "../types/rate-limiter"

import { RateLimitKVLayer } from "../utils/rate-limit/kv-layer"



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
            this.storage = new RateLimitKVLayer()
            this.config = {
                limits: { perIp: 0 },
                windows: { perIp: 0 },
                blocking: { enabled: false, escalationResetHours: 0, timeouts: [] }
            }
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

    async checkRateLimit(identifier: RateLimitIdentifier): Promise<RateLimitCheckResult | null> {
        if (!this.isEnabled) {
            return null
        }

        const now = Date.now()

        const blockResult = await this.checkIPBlock(identifier.ip)
        if (blockResult.isBlocked) {
            return blockResult
        }

        const checks = [
            { tier: 'global' as const, key: 'global', limit: this.config.limits.global, window: this.config.windows.global },
            { tier: 'ip' as const, key: identifier.ip, limit: this.config.limits.perIp, window: this.config.windows.perIp },
            { tier: 'reporter' as const, key: identifier.reporterId, limit: this.config.limits.perReporter, window: this.config.windows.perReporter },
            { tier: 'app' as const, key: identifier.appName, limit: this.config.limits.perApp, window: this.config.windows.perApp }
        ]

        for (const check of checks) {
            if (!check.limit || !check.window || !check.key) continue

            const result = await this.checkSlidingWindow(
                check.key,
                check.tier,
                check.limit,
                check.window,
                now
            )

            if (!result.allowed) {
                return result
            }
        }

        await this.recordRequest(identifier, now)

        return {
            allowed: true,
            tier: 'ip',
            limit: this.config.limits.perIp,
            current: 0,
            resetTime: now + (this.config.windows.perIp * 1000),
            retryAfter: 0
        }
    }

    private async checkSlidingWindow(
        key: string,
        tier: 'global' | 'ip' | 'reporter' | 'app',
        limit: number,
        windowSeconds: number,
        now: number
    ): Promise<RateLimitCheckResult> {
        const windowKey = `rate_limit:${tier}:${key}`
        const windowMs = windowSeconds * 1000
        const windowStart = now - windowMs

        const windowData = await this.storage.get<number[]>(windowKey) || []

        console.log(`Checking sliding window for ${tier}:${key}`, {
            windowKey,
            windowMs,
            windowStart,
            windowData
        })

        const validTimestamps = windowData.filter(timestamp => timestamp > windowStart)
        
        const current = validTimestamps.length
        const allowed = current < limit
        
        const oldestRequest = Math.min(...validTimestamps)
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
        const keys = [
            { tier: 'global', key: 'global', window: this.config.windows.global },
            { tier: 'ip', key: identifier.ip, window: this.config.windows.perIp },
            { tier: 'reporter', key: identifier.reporterId, window: this.config.windows.perReporter },
            { tier: 'app', key: identifier.appName, window: this.config.windows.perApp }
        ]

        const promises = keys
            .filter(item => item.key && item.window)
            .map(async (item) => {
                const windowKey = `rate_limit:${item.tier}:${item.key}`
                const windowMs = item.window! * 1000
                const windowStart = timestamp - windowMs

                const windowData = await this.storage.get<number[]>(windowKey) || []
                
                const updatedData = [...windowData, timestamp]
                    .filter(ts => ts > windowStart)
                    .sort((a, b) => b - a)
                    .slice(0, Math.max(this.config.limits.perIp, this.config.limits.perReporter || 0, this.config.limits.perApp || 0)) // Keep only what we need

                await this.storage.set(windowKey, updatedData, item.window! + 60)
            })

        await Promise.all(promises)
    }

    private async checkIPBlock(ip: string): Promise<RateLimitCheckResult> {
        if (!this.config.blocking.enabled) {
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
        if (!this.isEnabled || !this.config.blocking.enabled) return

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

        const checks = [
            { tier: 'global', key: 'global', limit: this.config.limits.global, window: this.config.windows.global },
            { tier: 'ip', key: identifier.ip, limit: this.config.limits.perIp, window: this.config.windows.perIp },
            { tier: 'reporter', key: identifier.reporterId, limit: this.config.limits.perReporter, window: this.config.windows.perReporter },
            { tier: 'app', key: identifier.appName, limit: this.config.limits.perApp, window: this.config.windows.perApp }
        ]

        for (const check of checks) {
            if (!check.limit || !check.window || !check.key) continue

            const windowKey = `rate_limit:${check.tier}:${check.key}`
            const windowMs = check.window * 1000
            const windowStart = now - windowMs

            const windowData = await this.storage.get<number[]>(windowKey) || []
            console.log(`Window data for ${check.tier}:${check.key}`, windowData)
            const current = windowData.filter(timestamp => timestamp > windowStart).length
            const oldestRequest = Math.min(...windowData.filter(ts => ts > windowStart))
            const resetTime = oldestRequest ? oldestRequest + windowMs : now + windowMs

            stats[check.tier] = {
                current,
                limit: check.limit,
                resetTime
            }
        }

        return stats
    }

    async cleanup(): Promise<void> {
        if (!this.isEnabled) return

        try {
            const keys = await this.storage.get(`frogger-rate-limiter:keys`) || []

            const cleanupPromises = keys.map(async (key: string) => {
                const value = await this.storage.get(key)
                if (value && typeof value === 'object' && 'expiresAt' in value) {
                    const wrapped = value as { data: any; expiresAt: number }
                    if (Date.now() > wrapped.expiresAt) {
                        await useStorage().removeItem(key)
                    }
                }
            })
            
            await Promise.all(cleanupPromises)
        }
        catch (error) {
            console.error('Failed to cleanup expired rate limit keys:', error)
        }
    }
}

export function getRateLimiter(): SlidingWindowRateLimiter {
    return SlidingWindowRateLimiter.getInstance()
}

export { extractRateLimitIdentifier } from '../utils/rate-limit/extract-identifier'