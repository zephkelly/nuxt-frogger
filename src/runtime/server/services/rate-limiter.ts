import type { IRateLimitStorage, RateLimitConfig, RateLimitIdentifier, RateLimitCheckResult } from "../types/rate-limiter";



export class SlidingWindowRateLimiter {
    private storage: IRateLimitStorage;
    private config: RateLimitConfig;

    constructor(storage: IRateLimitStorage, config: RateLimitConfig) {
        this.storage = storage;
        this.config = config;
    }

    async checkRateLimit(identifier: RateLimitIdentifier): Promise<RateLimitCheckResult> {
        const now = Date.now();

        const blockResult = await this.checkIPBlock(identifier.ip);
        if (blockResult.isBlocked) {
            return blockResult;
        }

        const checks = [
            { tier: 'global' as const, key: 'global', limit: this.config.limits.global, window: this.config.windows.global },
            { tier: 'ip' as const, key: identifier.ip, limit: this.config.limits.perIp, window: this.config.windows.perIp },
            { tier: 'reporter' as const, key: identifier.reporterId, limit: this.config.limits.perReporter, window: this.config.windows.perReporter },
            { tier: 'app' as const, key: identifier.appName, limit: this.config.limits.perApp, window: this.config.windows.perApp }
        ];

        for (const check of checks) {
            if (!check.limit || !check.window || !check.key) continue;

            const result = await this.checkSlidingWindow(
                check.key,
                check.tier,
                check.limit,
                check.window,
                now
            );

            if (!result.allowed) {
                return result;
            }
        }

        await this.recordRequest(identifier, now);

        return {
            allowed: true,
            tier: 'ip',
            limit: this.config.limits.perIp,
            current: 0,
            resetTime: now + (this.config.windows.perIp * 1000),
            retryAfter: 0
        };
    }

    private async checkSlidingWindow(
        key: string,
        tier: 'global' | 'ip' | 'reporter' | 'app',
        limit: number,
        windowSeconds: number,
        now: number
    ): Promise<RateLimitCheckResult> {
        const windowKey = `rate_limit:${tier}:${key}`;
        const windowMs = windowSeconds * 1000;
        const windowStart = now - windowMs;

        const windowData = await this.storage.get<number[]>(windowKey) || [];

        const validTimestamps = windowData.filter(timestamp => timestamp > windowStart);
        
        const current = validTimestamps.length;
        const allowed = current < limit;
        
        const oldestRequest = Math.min(...validTimestamps);
        const resetTime = oldestRequest ? oldestRequest + windowMs : now + windowMs;
        const retryAfter = allowed ? 0 : Math.ceil((resetTime - now) / 1000);

        return {
            allowed,
            tier,
            limit,
            current,
            resetTime,
            retryAfter
        };
    }

    private async recordRequest(identifier: RateLimitIdentifier, timestamp: number): Promise<void> {
        const keys = [
            { tier: 'global', key: 'global', window: this.config.windows.global },
            { tier: 'ip', key: identifier.ip, window: this.config.windows.perIp },
            { tier: 'reporter', key: identifier.reporterId, window: this.config.windows.perReporter },
            { tier: 'app', key: identifier.appName, window: this.config.windows.perApp }
        ];

        const promises = keys
            .filter(item => item.key && item.window)
            .map(async (item) => {
                const windowKey = `rate_limit:${item.tier}:${item.key}`;
                const windowMs = item.window! * 1000;
                const windowStart = timestamp - windowMs;

                const windowData = await this.storage.get<number[]>(windowKey) || [];
                
                const updatedData = [...windowData, timestamp]
                    .filter(ts => ts > windowStart)
                    .sort((a, b) => b - a)
                    .slice(0, Math.max(this.config.limits.perIp, this.config.limits.perReporter || 0, this.config.limits.perApp || 0));

                await this.storage.set(windowKey, updatedData, item.window! + 60);
            });

        await Promise.all(promises);
    }

    private async checkIPBlock(ip: string): Promise<RateLimitCheckResult> {
        if (!this.config.blocking.enabled) {
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 };
        }

        const blockKey = `ip_block:${ip}`;
        const blockData = await this.storage.get<{
            level: number;
            expiresAt: number;
            violations: number;
            lastViolation: number;
        }>(blockKey);

        if (!blockData) {
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 };
        }

        const now = Date.now();

        if (blockData.expiresAt <= now) {
            await this.storage.delete(blockKey);
            return { allowed: true, tier: 'ip', limit: 0, current: 0, resetTime: 0, retryAfter: 0 };
        }

        const retryAfter = Math.ceil((blockData.expiresAt - now) / 1000);

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
        };
    }

    async blockIP(ip: string): Promise<void> {
        if (!this.config.blocking.enabled) return;

        const blockKey = `ip_block:${ip}`;
        const now = Date.now();
        
        const existingBlock = await this.storage.get<{
            level: number;
            expiresAt: number;
            violations: number;
            lastViolation: number;
        }>(blockKey);

        let level = 0;
        let violations = 1;

        if (existingBlock) {
            const hoursSinceLastViolation = (now - existingBlock.lastViolation) / (1000 * 60 * 60);
            
            if (hoursSinceLastViolation < this.config.blocking.escalationResetHours) {
                level = Math.min(existingBlock.level + 1, this.config.blocking.timeouts.length - 1);
                violations = existingBlock.violations + 1;
            }
            else {
                level = 0;
                violations = 1;
            }
        }

        const timeoutSeconds = this.config.blocking.timeouts[level];
        const expiresAt = now + (timeoutSeconds * 1000);

        await this.storage.set(blockKey, {
            level,
            expiresAt,
            violations,
            lastViolation: now
        }, timeoutSeconds + 3600);
    }

    async clearIPBlock(ip: string): Promise<void> {
        const blockKey = `ip_block:${ip}`;
        await this.storage.delete(blockKey);
    }

    async getStats(identifier: RateLimitIdentifier): Promise<Record<string, { current: number; limit: number; resetTime: number }>> {
        const now = Date.now();
        const stats: Record<string, { current: number; limit: number; resetTime: number }> = {};

        const checks = [
            { tier: 'global', key: 'global', limit: this.config.limits.global, window: this.config.windows.global },
            { tier: 'ip', key: identifier.ip, limit: this.config.limits.perIp, window: this.config.windows.perIp },
            { tier: 'reporter', key: identifier.reporterId, limit: this.config.limits.perReporter, window: this.config.windows.perReporter },
            { tier: 'app', key: identifier.appName, limit: this.config.limits.perApp, window: this.config.windows.perApp }
        ];

        for (const check of checks) {
            if (!check.limit || !check.window || !check.key) continue;

            const windowKey = `rate_limit:${check.tier}:${check.key}`;
            const windowMs = check.window * 1000;
            const windowStart = now - windowMs;

            const windowData = await this.storage.get<number[]>(windowKey) || [];
            const current = windowData.filter(timestamp => timestamp > windowStart).length;
            const oldestRequest = Math.min(...windowData.filter(ts => ts > windowStart));
            const resetTime = oldestRequest ? oldestRequest + windowMs : now + windowMs;

            stats[check.tier] = {
                current,
                limit: check.limit,
                resetTime
            };
        }

        return stats;
    }
}
