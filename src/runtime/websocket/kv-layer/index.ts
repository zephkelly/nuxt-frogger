//@ts-ignore
import { useStorage } from '#imports'

import type { IWebSocketStorage } from './types';
import type { PersistedChannel, PersistedSubscription } from '../types';



/**
 * Nitro KV Storage adapter for WebSocket log reporter
 */
export class WebSocketKVLayer implements IWebSocketStorage {
    private readonly storageKey: string;
    private readonly channelPrefix: string;
    private readonly subscriptionPrefix: string;
    private readonly channelPeersPrefix: string;
    
    constructor(storageKey: string = 'websocket-log-reporter') {
        this.storageKey = storageKey;
        this.channelPrefix = `${storageKey}:channels`;
        this.subscriptionPrefix = `${storageKey}:subscriptions`;
        this.channelPeersPrefix = `${storageKey}:channel-peers`;
    }
    
    getStorageKey(): string {
        return this.storageKey;
    }
    
    private async get<T = any>(key: string): Promise<T | null> {
        try {
            const value = await useStorage().getItem(key);
            
            if (value && typeof value === 'object' && 'data' in value && 'expiresAt' in value) {
                const wrapped = value as { data: T; expiresAt: number };
                
                if (Date.now() > wrapped.expiresAt) {
                    await useStorage().removeItem(key);
                    return null;
                }
                
                return wrapped.data;
            }
            
            return value as T | null;
        }
        catch (error) {
            console.error(`Failed to get WebSocket storage key ${key}:`, error);
            return null;
        }
    }
    
    private async set(key: string, value: any, ttl?: number): Promise<void> {
        try {
            if (ttl) {
                const expiresAt = Date.now() + (ttl * 1000);
                const wrappedValue = {
                    data: value,
                    expiresAt
                };
                await useStorage().setItem(key, wrappedValue);
            }
            else {
                await useStorage().setItem(key, value);
            }
        }
        catch (error) {
            console.error(`Failed to set WebSocket storage key ${key}:`, error);
            throw error;
        }
    }
    
    private async delete(key: string): Promise<void> {
        try {
            await useStorage().removeItem(key);
        }
        catch (error) {
            console.error(`Failed to delete WebSocket storage key ${key}:`, error);
        }
    }
    
    private async getKeys(prefix: string): Promise<string[]> {
        try {
            return await useStorage().getKeys(prefix);
        }
        catch (error) {
            console.error(`Failed to get keys with prefix ${prefix}:`, error);
            return [];
        }
    }
    
    async getChannel(channelId: string): Promise<PersistedChannel | null> {
        const key = `${this.channelPrefix}:${channelId}`;
        return await this.get<PersistedChannel>(key);
    }
    
    async setChannel(channelId: string, channel: PersistedChannel, ttl?: number): Promise<void> {
        const key = `${this.channelPrefix}:${channelId}`;
        await this.set(key, channel, ttl);
    }
    
    async deleteChannel(channelId: string): Promise<void> {
        const channelKey = `${this.channelPrefix}:${channelId}`;
        const peersKey = `${this.channelPeersPrefix}:${channelId}`;
        
        await Promise.all([
            this.delete(channelKey),
            this.delete(peersKey)
        ]);
    }
    
    async getAllChannels(): Promise<PersistedChannel[]> {
        try {
            const keys = await this.getKeys(`${this.channelPrefix}:`);
            const channels: PersistedChannel[] = [];
            
            for (const key of keys) {
                const channel = await this.get<PersistedChannel>(key);
                if (channel) {
                    channels.push(channel);
                }
            }
            
            return channels;
        }
        catch (error) {
            console.error('Failed to get all channels:', error);
            return [];
        }
    }
    
    async getSubscription(peerId: string): Promise<PersistedSubscription | null> {
        const key = `${this.subscriptionPrefix}:${peerId}`;
        return await this.get<PersistedSubscription>(key);
    }
    
    async setSubscription(peerId: string, subscription: PersistedSubscription, ttl?: number): Promise<void> {
        const key = `${this.subscriptionPrefix}:${peerId}`;
        await this.set(key, subscription, ttl);
    }
    
    async deleteSubscription(peerId: string): Promise<void> {
        const key = `${this.subscriptionPrefix}:${peerId}`;
        await this.delete(key);
    }
    
    async getAllSubscriptions(): Promise<PersistedSubscription[]> {
        try {
            const keys = await this.getKeys(`${this.subscriptionPrefix}:`);
            const subscriptions: PersistedSubscription[] = [];
            
            for (const key of keys) {
                const subscription = await this.get<PersistedSubscription>(key);
                if (subscription) {
                    subscriptions.push(subscription);
                }
            }
            
            return subscriptions;
        }
        catch (error) {
            console.error('Failed to get all subscriptions:', error);
            return [];
        }
    }
    
    async addPeerToChannel(channelId: string, peerId: string): Promise<void> {
        try {
            const key = `${this.channelPeersPrefix}:${channelId}`;
            const currentPeers = await this.get<string[]>(key) || [];
            
            if (!currentPeers.includes(peerId)) {
                currentPeers.push(peerId);
                await this.set(key, currentPeers);
            }
        }
        catch (error) {
            console.error(`Failed to add peer ${peerId} to channel ${channelId}:`, error);
        }
    }
    
    async removePeerFromChannel(channelId: string, peerId: string): Promise<void> {
        try {
            const key = `${this.channelPeersPrefix}:${channelId}`;
            const currentPeers = await this.get<string[]>(key) || [];
            
            const updatedPeers = currentPeers.filter(id => id !== peerId);
            
            if (updatedPeers.length === 0) {
                await this.delete(key);
            } else {
                await this.set(key, updatedPeers);
            }
        }
        catch (error) {
            console.error(`Failed to remove peer ${peerId} from channel ${channelId}:`, error);
        }
    }
    
    async getChannelPeers(channelId: string): Promise<string[]> {
        try {
            const key = `${this.channelPeersPrefix}:${channelId}`;
            return await this.get<string[]>(key) || [];
        }
        catch (error) {
            console.error(`Failed to get peers for channel ${channelId}:`, error);
            return [];
        }
    }
    
    async updateChannelActivity(channelId: string): Promise<void> {
        try {
            const channel = await this.getChannel(channelId);
            if (channel) {
                channel.last_activity = new Date().getTime();
                await this.setChannel(channelId, channel);
            }
        }
        catch (error) {
            console.error(`Failed to update activity for channel ${channelId}:`, error);
        }
    }
    
    async updateSubscriptionActivity(peerId: string): Promise<void> {
        try {
            const subscription = await this.getSubscription(peerId);
            if (subscription) {
                subscription.last_activity = new Date().getTime();
                await this.setSubscription(peerId, subscription);
            }
        }
        catch (error) {
            console.error(`Failed to update activity for subscription ${peerId}:`, error);
        }
    }
    
    private async isExpired(fullKey: string): Promise<boolean> {
        try {
            const value = await useStorage().getItem(fullKey);
            if (!value || typeof value !== 'object') return false;
            
            const wrapped = value as { data: any; expiresAt: number };
            if (!wrapped.expiresAt) return false;
            
            return Date.now() > wrapped.expiresAt;
        }
        catch {
            return false;
        }
    }
    
    async cleanup(): Promise<void> {
        try {
            const prefixes = [
                this.channelPrefix,
                this.subscriptionPrefix,
                this.channelPeersPrefix
            ];
            
            for (const prefix of prefixes) {
                const keys = await this.getKeys(`${prefix}:`);
                const cleanupPromises = keys.map(async (key: string) => {
                    if (await this.isExpired(key)) {
                        await useStorage().removeItem(key);
                    }
                });
                
                await Promise.all(cleanupPromises);
            }
            
            await this.cleanupEmptyChannels();
        }
        catch (error) {
            console.error('Failed to cleanup WebSocket storage:', error);
        }
    }
    
    private async cleanupEmptyChannels(): Promise<void> {
        try {
            const channels = await this.getAllChannels();
            
            for (const channel of channels) {
                const peers = await this.getChannelPeers(channel.channel_uuid);
                
                if (peers.length === 0) {
                    const lastActivity = new Date(channel.last_activity);
                    const now = new Date();
                    const hoursSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
                    
                    if (hoursSinceActivity > 24) {
                        await this.deleteChannel(channel.channel_uuid);
                    }
                }
            }
        }
        catch (error) {
            console.error('Failed to cleanup empty channels:', error);
        }
    }
    
    async getStorageStats(): Promise<{
        totalChannels: number;
        totalSubscriptions: number;
        channelsWithPeers: number;
        orphanedPeerMappings: number;
    }> {
        try {
            const [channels, subscriptions] = await Promise.all([
                this.getAllChannels(),
                this.getAllSubscriptions()
            ]);
            
            let channelsWithPeers = 0;
            let orphanedPeerMappings = 0;
            
            for (const channel of channels) {
                const peers = await this.getChannelPeers(channel.channel_uuid);
                if (peers.length > 0) {
                    channelsWithPeers++;
                }
            }
            
            const peerMappingKeys = await this.getKeys(`${this.channelPeersPrefix}:`);
            for (const key of peerMappingKeys) {
                const channelId = key.split(':').pop();
                if (channelId && !channels.find(c => c.channel_uuid === channelId)) {
                    orphanedPeerMappings++;
                }
            }
            
            return {
                totalChannels: channels.length,
                totalSubscriptions: subscriptions.length,
                channelsWithPeers,
                orphanedPeerMappings
            };
        }
        catch (error) {
            console.error('Failed to get storage stats:', error);
            return {
                totalChannels: 0,
                totalSubscriptions: 0,
                channelsWithPeers: 0,
                orphanedPeerMappings: 0
            };
        }
    }
}