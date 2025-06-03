import { H3Event, createError, setResponseHeaders } from 'h3'

//@ts-ignore
import { useRuntimeConfig } from '#imports'

import type {
    IRateLimitStorage,
    RateLimitingOptions,
    RateLimitIdentifier,
    RateLimitCheckResult
} from '../rate-limiter/types/index'

import type { RateLimitScope } from '../shared/types/rate-limit'

import { RateLimitKVLayer } from './utils/kv-layer'
import { RateLimitResponseFactory } from './utils/response-factory';
import { extractRateLimitIdentifier } from '.';



interface ViolationRecord {
    count: number;
    firstViolation: number;
    lastViolation: number;
    currentBackoffTier: number;
    isBlocked: boolean;
    blockExpiresAt?: number;
    lastAction?: 'backoff' | 'block';
    escalationHistory?: Array<{
        timestamp: number;
        action: 'backoff' | 'block';
        tier?: number;
        duration?: number;
    }>;
}

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
                perIp: rateLimiterConfig.limits?.perIp,
                perReporter: rateLimiterConfig.limits?.perReporter,
                perApp: rateLimiterConfig.limits?.perApp
            },
            windows: {
                global: rateLimiterConfig.windows?.global,
                perIp: rateLimiterConfig.windows?.perIp,
                perReporter: rateLimiterConfig.windows?.perReporter,
                perApp: rateLimiterConfig.windows?.perApp
            },
            blocking: {
                enabled: rateLimiterConfig.blocking?.enabled,
                escalationResetHours: rateLimiterConfig.blocking?.escalationResetHours,
                timeouts: rateLimiterConfig.blocking?.timeouts,
                violationsBeforeBlock: rateLimiterConfig.blocking?.violationsBeforeBlock,
                finalBanHours: rateLimiterConfig.blocking?.finalBanHours
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
            { tier: 'ip', key: identifier.ip, limit: this.config.limits?.perIp, window: this.config.windows?.perIp },
            { tier: 'reporter', key: identifier.reporterId, limit: this.config.limits?.perReporter, window: this.config.windows?.perReporter }, 
            { tier: 'app', key: identifier.appName, limit: this.config.limits?.perApp, window: this.config.windows?.perApp },
            { tier: 'global', key: 'global', limit: this.config.limits?.global, window: this.config.windows?.global },
        ]
    }

    private getViolationTTL(): number {
        const escalationHours = this.config.blocking?.escalationResetHours || 24
        return (escalationHours + 24) * 60 * 60
    }

    private async checkViolations(ip: string, now: number): Promise<RateLimitCheckResult | null> {
        if (!this.config.blocking?.enabled) return null

        const violationKey = `violations:${ip}`
        const violationRecord = await this.storage.get<ViolationRecord>(violationKey)

        if (!violationRecord) return null

        if (violationRecord.isBlocked && violationRecord.blockExpiresAt && violationRecord.blockExpiresAt <= now) {
            violationRecord.isBlocked = false
            violationRecord.blockExpiresAt = undefined
            await this.storage.set(violationKey, violationRecord, this.getViolationTTL())
            return null
        }

        if (violationRecord.isBlocked && violationRecord.blockExpiresAt) {
            const retryAfter = Math.ceil((violationRecord.blockExpiresAt - now) / 1000)
            
            return {
                allowed: false,
                tier: 'ip',
                limit: 0,
                current: violationRecord.count,
                resetTime: violationRecord.blockExpiresAt,
                retryAfter,
                isBlocked: true,
                blockExpiresAt: violationRecord.blockExpiresAt,
                blockLevel: 0
            }
        }

        return null
    }

    private async recordViolation(ip: string, rateLimitResult: RateLimitCheckResult, now: number): Promise<RateLimitCheckResult> {
        if (!this.config.blocking?.enabled) {
            return { ...rateLimitResult }
        }

        const violationKey = `violations:${ip}`
        let violationRecord = await this.storage.get<ViolationRecord>(violationKey)

        const escalationWindow = this.config.blocking.escalationResetHours * 60 * 60 * 1000

        if (!violationRecord) {
            violationRecord = {
                count: 1,
                firstViolation: now,
                lastViolation: now,
                currentBackoffTier: 0,
                isBlocked: false,
                lastAction: 'backoff',
                escalationHistory: []
            }
        }
        else {
            if (now - violationRecord.lastViolation > escalationWindow) {
                violationRecord = {
                    count: 1,
                    firstViolation: now,
                    lastViolation: now,
                    currentBackoffTier: 0,
                    isBlocked: false,
                    lastAction: 'backoff',
                    escalationHistory: []
                }
            }
            else {
                violationRecord.count++
                violationRecord.lastViolation = now
            }
        }

        const violationsBeforeBlock = this.config.blocking?.violationsBeforeBlock || 3
        const backoffTimeouts = this.config.blocking.timeouts || [60, 300, 1800]
        const blockDurationHours = this.config.blocking.finalBanHours || 24

        let action: 'backoff' | 'block' = 'backoff'
        let timeoutDuration = 0
        let isBlocked = false

        if (violationRecord.count <= violationsBeforeBlock) {
            action = 'backoff'
            const backoffTier = violationRecord.count - 1
            
            if (backoffTier < backoffTimeouts.length) {
                timeoutDuration = backoffTimeouts[backoffTier]
                violationRecord.currentBackoffTier = backoffTier
            }
            else {
                timeoutDuration = backoffTimeouts[backoffTimeouts.length - 1]
                violationRecord.currentBackoffTier = backoffTimeouts.length - 1
            }
        }
        else {
            action = 'block'
            timeoutDuration = blockDurationHours * 60 * 60
            isBlocked = true
            violationRecord.isBlocked = true
            violationRecord.blockExpiresAt = now + (timeoutDuration * 1000)
        }

        violationRecord.lastAction = action
        
        if (!violationRecord.escalationHistory) {
            violationRecord.escalationHistory = []
        }
        
        violationRecord.escalationHistory.push({
            timestamp: now,
            action,
            tier: action === 'backoff' ? violationRecord.currentBackoffTier : undefined,
            duration: timeoutDuration
        })

        if (violationRecord.escalationHistory.length > 10) {
            violationRecord.escalationHistory = violationRecord.escalationHistory.slice(-10)
        }

        await this.storage.set(violationKey, violationRecord, this.getViolationTTL())

        const response: RateLimitCheckResult = {
            ...rateLimitResult,
            isBlocked,
            retryAfter: timeoutDuration,
            resetTime: isBlocked ? violationRecord.blockExpiresAt! : (now + (timeoutDuration * 1000))
        }

        if (isBlocked && violationRecord.blockExpiresAt) {
            response.blockExpiresAt = violationRecord.blockExpiresAt
            response.blockLevel = 0
            response.limit = 0
            response.current = violationRecord.count
        }
        else {
            response.backoffLevel = violationRecord.currentBackoffTier
        }

        return response
    }

    async clearViolations(ip: string): Promise<void> {
        if (!this.isEnabled) return
        
        const violationKey = `violations:${ip}`
        await this.storage.delete(violationKey)
    }

    async getViolationStatus(ip: string): Promise<ViolationRecord | null> {
        if (!this.isEnabled) return null
        
        const violationKey = `violations:${ip}`
        return await this.storage.get<ViolationRecord>(violationKey)
    }

    async getViolationDetails(ip: string): Promise<{
        record: ViolationRecord | null;
        currentStatus: 'allowed' | 'blocked' | 'backing_off';
        timeUntilReset?: number;
        nextAction?: 'backoff' | 'block';
        currentPhase?: 'backoff' | 'block';
    }> {
        if (!this.isEnabled) {
            return { record: null, currentStatus: 'allowed' }
        }
        
        const now = Date.now()
        const violationRecord = await this.getViolationStatus(ip)
        
        if (!violationRecord) {
            return { record: null, currentStatus: 'allowed' }
        }
        
        if (violationRecord.isBlocked && violationRecord.blockExpiresAt) {
            if (violationRecord.blockExpiresAt <= now) {
                return { 
                    record: violationRecord, 
                    currentStatus: 'allowed',
                    timeUntilReset: 0
                }
            } else {
                return { 
                    record: violationRecord, 
                    currentStatus: 'blocked',
                    timeUntilReset: Math.max(0, Math.round((violationRecord.blockExpiresAt - now) / 1000)),
                    currentPhase: 'block'
                }
            }
        }
        
        const violationsBeforeBlock = this.config.blocking?.violationsBeforeBlock || 3
        const nextAction = violationRecord.count >= violationsBeforeBlock ? 'block' : 'backoff'
        
        return { 
            record: violationRecord, 
            currentStatus: 'backing_off',
            nextAction,
            currentPhase: 'backoff'
        }
    }

    async checkRateLimit(identifier: RateLimitIdentifier): Promise<RateLimitCheckResult[] | null> {
        if (!this.isEnabled) {
            return null
        }

        const now = Date.now()

        const violationResult = await this.checkViolations(identifier.ip, now)
        if (violationResult && !violationResult.allowed) {
            return [violationResult]
        }

        const checks = this.getChecks(identifier)
        const results: RateLimitCheckResult[] = []
        const failedResults: RateLimitCheckResult[] = []

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

            if (!result.allowed) {
                failedResults.push(result)
            }
        }

        if (failedResults.length > 0) {
            const primaryFailure = failedResults[0]
            const violationResponse = await this.recordViolation(identifier.ip, primaryFailure, now)
            return [violationResponse]
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
            windowData = windowData
                .filter(timestamp => timestamp > windowStart)
                .sort((a, b) => b - a)
                .slice(0, limit * 2)
            
            await this.storage.set(windowKey, windowData, windowSeconds + 60)
        }

        const validTimestamps = windowData.filter(timestamp => timestamp > windowStart).slice(0, Math.max(limit * 2, 1000))
        
        const current = validTimestamps.length + 1
        const allowed = current < limit + 1
        
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

            if (!rateLimitResults || rateLimitResults.length === 0) return;

            let primaryResult: RateLimitCheckResult;
            
            if (rateLimitResults.length === 1) {
                primaryResult = rateLimitResults[0];
            }
            else {
                primaryResult = rateLimitResults.reduce((mostRestrictive, current) => {
                    const currentRemaining = Math.max(0, current.limit - current.current);
                    const restrictiveRemaining = Math.max(0, mostRestrictive.limit - mostRestrictive.current);
                    
                    if (currentRemaining < restrictiveRemaining) {
                        return current;
                    }
                    else if (currentRemaining === restrictiveRemaining) {
                        const tierPriority = { 'ip': 1, 'reporter': 2, 'app': 3, 'global': 4 };
                        return tierPriority[current.tier] < tierPriority[mostRestrictive.tier] ? current : mostRestrictive;
                    }
                    return mostRestrictive;
                });
            }

            const infoHeaders = RateLimitResponseFactory.createInfoHeaders(primaryResult);
            setResponseHeaders(event, infoHeaders);

            if (!primaryResult.allowed) {
                const response = RateLimitResponseFactory.createH3Response(primaryResult);
                const mergedHeaders = { ...infoHeaders, ...response.headers };
                setResponseHeaders(event, mergedHeaders);
                throw createError(response);
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

export { extractRateLimitIdentifier } from './utils/identifiers'