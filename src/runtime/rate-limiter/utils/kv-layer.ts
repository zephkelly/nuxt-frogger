//@ts-ignore
// import { useStorage } from '#imports'
import type { IRateLimitStorage } from '../types/storage'



/**
 * Nitro KV Storage adapter for rate limiting
 */
export class RateLimitKVLayer implements IRateLimitStorage {
    private readonly storageKey: string
    
    constructor(storageKey: string = 'frogger-rate-limiter') {
        this.storageKey = storageKey
    }

    getStorageKey(): string {
        return this.storageKey
    }
    
    async get<T = any>(key: string): Promise<T | null> {
        try {
            const fullKey = `${this.storageKey}:${key}`
            //@ts-ignore
            const value = await useStorage().getItem(fullKey)
            
            if (value && typeof value === 'object' && 'data' in value && 'expiresAt' in value) {
                const wrapped = value as { data: T; expiresAt: number }
                
                if (Date.now() > wrapped.expiresAt) {
                    await this.delete(key)
                    return null
                }
                
                return wrapped.data
            }
            
            return value as T | null
        }
        catch (error) {
            console.error(`Failed to get rate limit key ${key}:`, error)
            return null
        }
    }
    
    async set(key: string, value: any, ttl?: number): Promise<void> {
        try {
            const fullKey = `${this.storageKey}:${key}`
           
            if (ttl) {
                const expiresAt = Date.now() + (ttl * 1000)
                const wrappedValue = {
                    data: value,
                    expiresAt
                }
                //@ts-ignore
                await useStorage().setItem(fullKey, wrappedValue)
            }
            else {
                //@ts-ignore
                await useStorage().setItem(fullKey, value)
            }
        }
        catch (error) {
            console.error(`Failed to set rate limit key ${key}:`, error)
            throw error
        }
    }
    
    async delete(key: string): Promise<void> {
        try {
            const fullKey = `${this.storageKey}:${key}`
            //@ts-ignore
            await useStorage().removeItem(fullKey)
        }
        catch (error) {
            console.error(`Failed to delete rate limit key ${key}:`, error)
        }
    }
    
    async increment(key: string, ttl?: number): Promise<number> {
        try {
            const current = await this.get<number>(key) || 0
            const newValue = current + 1
            await this.set(key, newValue, ttl)
            return newValue
        } catch (error) {
            console.error(`Failed to increment rate limit key ${key}:`, error)
            throw error
        }
    }
    
    private async isExpired(fullKey: string): Promise<boolean> {
        try {
            //@ts-ignore
            const value = await useStorage().getItem(fullKey)
            if (!value || typeof value !== 'object') return false
           
            const wrapped = value as { data: any; expiresAt: number }
            if (!wrapped.expiresAt) return false
           
            return Date.now() > wrapped.expiresAt
        } catch {
            return false
        }
    }
    
    async cleanup(): Promise<void> {
        try {
            //@ts-ignore
            const keys = await useStorage().getKeys(`${this.storageKey}:`)
            const cleanupPromises = keys.map(async (key: string) => {
                if (await this.isExpired(key)) {
                    //@ts-ignore
                    await useStorage().removeItem(key)
                }
            })
           
            await Promise.all(cleanupPromises)
        }
        catch (error) {
            console.error('Failed to cleanup expired rate limit keys:', error)
        }
    }
}