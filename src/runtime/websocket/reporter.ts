import { Peer } from "crossws";

import type { IReporter } from "../shared/types/internal-reporter";
import type  { IWebSocketStorage } from "./kv-layer/types";
import type { LoggerObject } from "../shared/types/log";

import type {
    SubscriptionFilter,
    PersistedChannel,
    PersistedSubscription
} from "./types";

import { WebSocketKVLayer } from "./kv-layer";
import { LogLevelFilter } from "../shared/utils/log-level-filter";



export class WebSocketLogReporter implements IReporter {
    public readonly name = 'WebSocketLogReporter';
    public readonly reporterId: string;

    private static instance: WebSocketLogReporter | null = null;
    private channels: Map<string, PersistedChannel> = new Map();
    private subscriptions: Map<string, PersistedSubscription> = new Map();
    private storage: IWebSocketStorage;
    private cleanupInterval: NodeJS.Timeout | null = null;

    private readonly CLEANUP_INTERVAL = 1000 * 60 * 5;
    private readonly STALE_CHANNEL_TIMEOUT = 1000 * 60 * 30;
    private readonly MESSAGE_RATE_LIMIT = 100;
    private lastMessageTimes: Map<string, number> = new Map();

    private constructor(storage?: IWebSocketStorage) {
        this.reporterId = `websocket-reporter-${Date.now()}`;
        this.storage = storage || new WebSocketKVLayer();
        this.startCleanupInterval();
        
        // Load persisted data on startup
        this.loadPersistedData().catch(error => {
            console.error('WebSocketLogReporter: Failed to load persisted data:', error);
        });
    }

    public static getInstance(storage?: IWebSocketStorage): WebSocketLogReporter {
        if (!WebSocketLogReporter.instance) {
            WebSocketLogReporter.instance = new WebSocketLogReporter(storage);
        }
        return WebSocketLogReporter.instance;
    }

    public static async destroyInstance(): Promise<void> {
        if (WebSocketLogReporter.instance) {
            await WebSocketLogReporter.instance.destroy();
            WebSocketLogReporter.instance = null;
        }
    }

    private async loadPersistedData(): Promise<void> {
        try {
            console.log('WebSocketLogReporter: Loading persisted data...');
            
            const [persistedChannels, persistedSubscriptions] = await Promise.all([
                this.storage.getAllChannels(),
                this.storage.getAllSubscriptions()
            ]);

            for (const persistedChannel of persistedChannels) {
                const channel: PersistedChannel = {
                    channel_uuid: persistedChannel.channel_uuid,
                    subscribers: new Map(),
                    created_at: new Date(persistedChannel.created_at).getTime(),
                    last_activity: new Date(persistedChannel.last_activity).getTime(),
                    metadata: persistedChannel.metadata
                };
                
                this.channels.set(persistedChannel.channel_uuid, channel);
            }

            
            console.log(`WebSocketLogReporter: Loaded ${persistedChannels.length} channels`);
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error loading persisted data:', error);
        }
    }

    public log(logObj: LoggerObject): void {
        this.broadcastLog(logObj);
    }

    public logBatch(logs: LoggerObject[]): void {
        for (const log of logs) {
            this.broadcastLog(log);
        }
    }

    public async flush(): Promise<void> {
        return Promise.resolve();
    }

    public async forceFlush(): Promise<void> {
        return this.flush();
    }

    public async destroy(): Promise<void> {
        try {
            console.log('WebSocketLogReporter: Starting shutdown...');
            
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            await this.persistCurrentState();

            const cleanupPromises = Array.from(this.channels.keys()).map(
                channelId => this.cleanupChannel(channelId, false)
            );

            await Promise.allSettled(cleanupPromises);

            this.channels.clear();
            this.subscriptions.clear();
            this.lastMessageTimes.clear();

            console.log('WebSocketLogReporter: Shutdown complete');
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error during shutdown:', error);
            throw error;
        }
    }

    private async persistCurrentState(): Promise<void> {
        try {
            const persistPromises: Promise<void>[] = [];

            for (const [channelId, channel] of this.channels.entries()) {
                const persistedChannel: PersistedChannel = {
                    channel_uuid: channel.channel_uuid,
                    created_at: channel.created_at,
                    last_activity: channel.last_activity,
                    subscribers: channel.subscribers
                };

                persistPromises.push(this.storage.setChannel(channelId, persistedChannel));
            }

            for (const [peerId, subscription] of this.subscriptions.entries()) {
                const persistedSubscription: PersistedSubscription = {
                    peer_id: subscription.peer_id,
                    channels: subscription.channels,
                    filters: subscription.filters,
                    subscribed_at: subscription.subscribed_at,
                    last_activity: subscription.last_activity
                };
                
                persistPromises.push(this.storage.setSubscription(peerId, persistedSubscription));
            }

            await Promise.allSettled(persistPromises);
            console.log('WebSocketLogReporter: Current state persisted');
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error persisting current state:', error);
        }
    }

    public async createChannel(channelId: string, metadata?: Record<string, any>): Promise<PersistedChannel> {
        if (this.channels.has(channelId)) {
            return this.channels.get(channelId)!;
        }

        const now = new Date();
        const channel: PersistedChannel = {
            channel_uuid: channelId,
            subscribers: new Map(),
            created_at: now.getTime(),
            last_activity: now.getTime(),
            metadata
        };

        this.channels.set(channelId, channel);

        const persistedChannel: PersistedChannel = {
            channel_uuid: channelId,
            created_at: now.getTime(),
            last_activity: now.getTime(),
            subscribers: new Map(),
            metadata
        };

        try {
            await this.storage.setChannel(channelId, persistedChannel);
        }
        catch (error) {
            console.error(`WebSocketLogReporter: Failed to persist channel ${channelId}:`, error);
        }

        console.log(`WebSocketLogReporter: Channel ${channelId} created`);
        return channel;
    }

    public getChannel(channelId: string): PersistedChannel | undefined {
        return this.channels.get(channelId);
    }

    public getChannels(): PersistedChannel[] {
        return Array.from(this.channels.values());
    }

    public async subscribe(
        peer: Peer, 
        channelId: string, 
        filters?: SubscriptionFilter
    ): Promise<boolean> {
        try {
            if (filters?.level !== undefined && typeof filters.level === 'number') {
                if (filters.level < 0 || filters.level > 5) {
                    console.error(`WebSocketLogReporter: Invalid log level ${filters.level}. Must be between 0-5`);
                    return false;
                }
            }

            const channel = await this.createChannel(channelId);

            await this.removeSubscription(peer.id);

            channel.subscribers.set(peer.id, peer);
            channel.last_activity = new Date().getTime();

            const now = new Date();
            const subscription: PersistedSubscription = {
                peer_id: peer.id,
                channels: [channelId],
                filters,
                subscribed_at: now.getTime(),
                last_activity: now.getTime()
            };

            this.subscriptions.set(peer.id, subscription);

            if (filters?.level !== undefined) {
                const levelDesc = LogLevelFilter.describeLevelFilter(filters.level);
                console.log(`WebSocketLogReporter: Admin ${peer.id} subscribed with level filter: ${levelDesc}`);
            }

            try {
                const persistedSubscription: PersistedSubscription = {
                    peer_id: peer.id,
                    channels: [channelId],
                    filters,
                    subscribed_at: now.getTime(),
                    last_activity: now.getTime()
                };

                await Promise.all([
                    this.storage.setSubscription(peer.id, persistedSubscription),
                    this.storage.addPeerToChannel(channelId, peer.id),
                    this.storage.updateChannelActivity(channelId)
                ]);
            }
            catch (error) {
                console.error(`WebSocketLogReporter: Failed to persist subscription for ${peer.id}:`, error);
            }

            console.log(`WebSocketLogReporter: Admin ${peer.id} subscribed to channel ${channelId}`);
            return true;
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error subscribing admin to channel:', error);
            return false;
        }
    }

    public async reconnectSubscription(peer: Peer): Promise<boolean> {
        try {
            const persistedSubscription = await this.storage.getSubscription(peer.id);
            
            if (!persistedSubscription) {
                return false;
            }

            const subscription: PersistedSubscription = {
                peer_id: persistedSubscription.peer_id,
                channels: persistedSubscription.channels,
                filters: persistedSubscription.filters,
                subscribed_at: persistedSubscription.subscribed_at,
                last_activity: new Date().getTime()
            };

            this.subscriptions.set(peer.id, subscription);

            for (const channelId of subscription.channels) {
                let channel = this.channels.get(channelId);
                
                if (!channel) {
                    channel = await this.createChannel(channelId);
                }

                channel.subscribers.set(peer.id, peer);
                channel.last_activity = new Date().getTime();
            }

            try {
                await Promise.all([
                    this.storage.updateSubscriptionActivity(peer.id),
                    ...subscription.channels.map(channelId => 
                        this.storage.updateChannelActivity(channelId)
                    )
                ]);
            }
            catch (error) {
                console.error(`WebSocketLogReporter: Failed to update activities for reconnected admin ${peer.id}:`, error);
            }

            console.log(`WebSocketLogReporter: Admin ${peer.id} reconnected to ${subscription.channels.length} channels`);
            return true;
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error reconnecting admin:', error);
            return false;
        }
    }

    public async removeSubscription(peerId: string): Promise<boolean> {
        try {
            const subscription = this.subscriptions.get(peerId);
            if (!subscription) {
                return false;
            }

            for (const channelId of subscription.channels) {
                const channel = this.channels.get(channelId);
                if (channel) {
                    channel.subscribers.delete(peerId);
                    
                    if (channel.subscribers.size === 0) {
                        await this.cleanupChannel(channelId);
                    }
                }

                try {
                    await this.storage.removePeerFromChannel(channelId, peerId);
                }
                catch (error) {
                    console.error(`WebSocketLogReporter: Failed to remove peer from channel storage:`, error);
                }
            }

            this.subscriptions.delete(peerId);
            
            const peerKeys = Array.from(this.lastMessageTimes.keys())
                .filter(key => key.includes(peerId));
            peerKeys.forEach(key => this.lastMessageTimes.delete(key));

            try {
                await this.storage.deleteSubscription(peerId);
            }
            catch (error) {
                console.error(`WebSocketLogReporter: Failed to delete subscription from storage:`, error);
            }

            console.log(`WebSocketLogReporter: Admin ${peerId} unsubscribed`);
            return true;
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error unsubscribing admin:', error);
            return false;
        }
    }

    public getSubscription(peerId: string): PersistedSubscription | undefined {
        return this.subscriptions.get(peerId);
    }

    private async broadcastLog(logObj: LoggerObject): Promise<void> {
        for (const [channelId, channel] of this.channels.entries()) {
            if (channel.subscribers.size === 0) {
                continue;
            }

            if (!this.shouldSendMessage(channelId)) {
                continue;
            }

            channel.last_activity = new Date().getTime();

            if (Math.random() < 0.1) {
                this.storage.updateChannelActivity(channelId).catch((error: unknown) => {
                    console.error(`WebSocketLogReporter: Failed to update channel activity:`, error);
                });
            }
            for (const [peerId, peer] of channel.subscribers) {
                const subscription = this.subscriptions.get(peerId);
                if (subscription) {
                    subscription.last_activity = new Date().getTime();
                    this.subscriptions.set(peerId, subscription);
                    this.storage.updateSubscriptionActivity(peerId).catch((error: unknown) => {
                        console.error(`WebSocketLogReporter: Failed to update subscription activity for ${peerId}:`, error);
                    });
                }
            }       
            for (const [peerId, peer] of channel.subscribers) {
                const subscription = this.subscriptions.get(peerId);
                if (!peer || !peer.websocket) {
                    channel.subscribers.delete(peerId);
                    continue;
                }
                
                if (subscription?.filters && !this.passesFilter(logObj, subscription.filters)) {
                    continue;
                }

                this.sendLogToPeer(peer, logObj, channelId).catch(error => {
                    console.error(`WebSocketLogReporter: Error sending log to peer ${peerId}:`, error);
                });
            }
        }
    }

    private async sendLogToPeer(peer: Peer, logObj: LoggerObject, channelId: string): Promise<void> {
        try {
            const message = {
                type: 'log',
                channel: channelId,
                timestamp: new Date().toISOString(),
                data: logObj
            };

            await peer.send(JSON.stringify(message));
        }
        catch (error) {
            console.error('WebSocketLogReporter: Failed to send message to peer:', error);
            throw error;
        }
    }

    private passesFilter(logObj: LoggerObject, filters: SubscriptionFilter): boolean {
        if (filters.level !== undefined) {
            if (!logObj.ctx || !logObj.ctx.type) {
                return false;
            }

            if (!LogLevelFilter.passesLevelFilter(logObj.ctx.type, filters.level)) {
                return false;
            }
        }

        if (filters.source && filters.source.length > 0) {
            if (!filters.source.includes(logObj.source || '')) {
                return false;
            }
        }

        if (filters.tags && filters.tags.length > 0) {
            const logTags = logObj.tags || [];
            const hasMatchingTag = filters.tags.some(filterTag => 
                logTags.includes(filterTag)
            );
            if (!hasMatchingTag) {
                return false;
            }
        }

        return true;
    }

    private shouldSendMessage(channelId: string): boolean {
        const now = Date.now();
        const lastTime = this.lastMessageTimes.get(channelId) || 0;
        
        if (now - lastTime < this.MESSAGE_RATE_LIMIT) {
            return false;
        }
        
        this.lastMessageTimes.set(channelId, now);
        return true;
    }

    private startCleanupInterval(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleChannels().catch(err => 
                console.error('WebSocketLogReporter: Error in cleanup interval:', err)
            );
        }, this.CLEANUP_INTERVAL);
    }

    private async cleanupStaleChannels(): Promise<void> {
        const now = new Date();
        const cleanupPromises: Promise<void>[] = [];

        for (const [channelId, channel] of this.channels.entries()) {
            const timeSinceActivity = now.getTime() - channel.last_activity;
            
            if (channel.subscribers.size === 0 || timeSinceActivity > this.STALE_CHANNEL_TIMEOUT) {
                cleanupPromises.push(this.cleanupChannel(channelId));
            }
        }

        await Promise.allSettled(cleanupPromises);

        this.storage.cleanup().catch((error: unknown) => {
            console.error('WebSocketLogReporter: Storage cleanup failed:', error);
        });
    }

    private async cleanupChannel(channelId: string, deleteFromStorage: boolean = true): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) return;

        try {
            const cleanupPromises: Promise<void>[] = [];
            
            for (const [peerId, peer] of channel.subscribers) {
                cleanupPromises.push(this.cleanupPeer(peer, peerId));
            }

            await Promise.allSettled(cleanupPromises);

            channel.subscribers.clear();
            this.channels.delete(channelId);

            if (deleteFromStorage) {
                try {
                    await this.storage.deleteChannel(channelId);
                } catch (error) {
                    console.error(`WebSocketLogReporter: Failed to delete channel from storage:`, error);
                }
            }

            console.log(`WebSocketLogReporter: Channel ${channelId} cleaned up`);
        }
        catch (error) {
            console.error(`WebSocketLogReporter: Error cleaning up channel ${channelId}:`, error);
            this.channels.delete(channelId);
        }
    }

    private async cleanupPeer(peer: Peer, peerId: string): Promise<void> {
        try {
            if (peer.websocket) {
                await peer.close(1000, 'Channel cleanup');
            }
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error closing peer connection:', error);
        }

        await this.removeSubscription(peerId);
    }

    public async getStatus(): Promise<{
        channels: number;
        totalSubscribers: number;
        activeSubscriptions: number;
        storage: any;
        channelDetails: Array<{
            uuid: string;
            subscribers: number;
            created_at: number;
            last_activity: number;
        }>;
    }> {
        const channelDetails = Array.from(this.channels.values()).map(channel => ({
            uuid: channel.channel_uuid,
            subscribers: channel.subscribers.size,
            created_at: channel.created_at,
            last_activity: channel.last_activity
        }));

        const totalSubscribers = Array.from(this.channels.values())
            .reduce((sum, channel) => sum + channel.subscribers.size, 0);

        const storageStats = await this.storage.getStorageStats().catch(() => ({
            totalChannels: 0,
            totalSubscriptions: 0,
            channelsWithPeers: 0,
            orphanedPeerMappings: 0
        }));

        return {
            channels: this.channels.size,
            totalSubscribers,
            activeSubscriptions: this.subscriptions.size,
            storage: storageStats,
            channelDetails
        };
    }

    public async getPersistedChannels(): Promise<PersistedChannel[]> {
        return await this.storage.getAllChannels();
    }

    public async getPersistedSubscriptions(): Promise<PersistedSubscription[]> {
        return await this.storage.getAllSubscriptions();
    }

    public getFilterDescription(filters?: SubscriptionFilter): string {
        if (!filters) {
            return 'No filters (all logs)';
        }

        const parts: string[] = [];

        if (filters.level !== undefined) {
            parts.push(`Levels: ${LogLevelFilter.describeLevelFilter(filters.level)}`);
        }

        if (filters.source && filters.source.length > 0) {
            parts.push(`Sources: ${filters.source.join(', ')}`);
        }

        if (filters.tags && filters.tags.length > 0) {
            parts.push(`Tags: ${filters.tags.join(', ')}`);
        }

        return parts.length > 0 ? parts.join(' | ') : 'No filters (all logs)';
    }
}