import { Peer } from "crossws";

import type { IWebSocketTransport } from "./../../websocket/types";
import type { IWebSocketStateStorage } from "../../websocket/state/types";
import type { LoggerObject } from "../../shared/types/log";

import type {
    SubscriptionFilter,
    PersistedChannel,
    PersistedSubscription,
    LogMessage
} from "../../websocket/types";

import { createWebSocketStateKVLayer } from "../../websocket/state/factory";
import { LogLevelParser, type LogLevelInput } from "../../shared/utils/log-level-parser";
import type { IFroggerTransport } from "./types";



export class WebSocketTransport implements IFroggerTransport {
    public readonly name = 'WebSocketTransport';
    public readonly transportId: string;

    private static instance: WebSocketTransport | null = null;
    private channels: Map<string, PersistedChannel> = new Map();
    private subscriptions: Map<string, PersistedSubscription> = new Map();
    private state: IWebSocketStateStorage;
    private cleanupInterval: NodeJS.Timeout | null = null;

    private readonly CLEANUP_INTERVAL = 1000 * 60 * 5;
    private readonly STALE_CHANNEL_TIMEOUT = 1000 * 60 * 30;
    private readonly MESSAGE_RATE_LIMIT = 100;
    private lastMessageTimes: Map<string, number> = new Map();

    private constructor(storage?: IWebSocketStateStorage) {
        this.transportId = `websocket-reporter-${Date.now()}`;
        this.state = storage || createWebSocketStateKVLayer('frogger-websocket-transport');
        this.startCleanupInterval();

        this.loadPersistedData().catch(error => {
            console.error('WebSocketTransport: Failed to load persisted data:', error);
        });
    }

    public static getInstance(state?: IWebSocketStateStorage) {
        if (!WebSocketTransport.instance) {
            WebSocketTransport.instance = new WebSocketTransport(state);
        }
        return WebSocketTransport.instance;
    }

    public static async destroyInstance(): Promise<void> {
        if (WebSocketTransport.instance) {
            await WebSocketTransport.instance.destroy();
            WebSocketTransport.instance = null;
        }
    }

    private async loadPersistedData(): Promise<void> {
        try {
            const [persistedChannels, persistedSubscriptions] = await Promise.all([
                this.state.getAllChannels(),
                this.state.getAllSubscriptions()
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
        }
        catch (error) {
            console.error('WebSocketTransport: Error loading persisted data:', error);
        }
    }

    public log(logObj: LoggerObject): void {
        console.log('WebSocketTransport: Broadcasting log');
        this.broadcastLogBatch([logObj]).catch(error => {
            console.error('WebSocketTransport: Error broadcasting log:', error);
        });
    }

    public logBatch(logs: LoggerObject[]): void {
        if (!logs || logs.length === 0) {
            return;
        }

        this.broadcastLogBatch(logs).catch(error => {
            console.error('WebSocketTransport: Error broadcasting log batch:', error);
        });
    }

    public async flush(): Promise<void> {
        return Promise.resolve();
    }

    public async forceFlush(): Promise<void> {
        return this.flush();
    }

    public async destroy(): Promise<void> {
        try {
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
        }
        catch (error) {
            console.error('WebSocketTransport: Error during shutdown:', error);
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

                persistPromises.push(this.state.setChannel(channelId, persistedChannel));
            }

            for (const [peerId, subscription] of this.subscriptions.entries()) {
                const persistedSubscription: PersistedSubscription = {
                    peer_id: subscription.peer_id,
                    channels: subscription.channels,
                    filters: subscription.filters,
                    subscribed_at: subscription.subscribed_at,
                    last_activity: subscription.last_activity
                };

                persistPromises.push(this.state.setSubscription(peerId, persistedSubscription));
            }

            await Promise.allSettled(persistPromises);
        }
        catch (error) {
            console.error('WebSocketTransport: Error persisting current state:', error);
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
            await this.state.setChannel(channelId, persistedChannel);
        }
        catch (error) {
            console.error(`WebSocketTransport: Failed to persist channel ${channelId}:`, error);
        }

        console.log(
            '🐸 \x1b[32mFROGGER\x1b[0m',
            `Websocket channel '${channelId}' has been created`
        );
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
            // Validate level filters if provided
            if (filters?.level !== undefined) {
                const levelsToValidate = Array.isArray(filters.level) ? filters.level : [filters.level];

                for (const level of levelsToValidate) {
                    try {
                        LogLevelParser.parse(level);
                    } catch (error) {
                        console.error(`WebSocketTransport: Invalid log level '${level}':`, error);
                        return false;
                    }
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

            // if (filters?.level !== undefined) {
            //     const levelDesc = LogLevelFilter.describeLevelFilter(filters.level);
            // }

            try {
                const persistedSubscription: PersistedSubscription = {
                    peer_id: peer.id,
                    channels: [channelId],
                    filters,
                    subscribed_at: now.getTime(),
                    last_activity: now.getTime()
                };

                await Promise.all([
                    this.state.setSubscription(peer.id, persistedSubscription),
                    this.state.addPeerToChannel(channelId, peer.id),
                    this.state.updateChannelActivity(channelId)
                ]);
            }
            catch (error) {
                console.error(`WebSocketTransport: Failed to persist subscription for ${peer.id}:`, error);
            }

            return true;
        }
        catch (error) {
            console.error('WebSocketTransport: Error subscribing admin to channel:', error);
            return false;
        }
    }

    public async reconnectSubscription(peer: Peer): Promise<boolean> {
        try {
            const persistedSubscription = await this.state.getSubscription(peer.id);

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
                    this.state.updateSubscriptionActivity(peer.id),
                    ...subscription.channels.map(channelId =>
                        this.state.updateChannelActivity(channelId)
                    )
                ]);
            }
            catch (error) {
                console.error(`WebSocketTransport: Failed to update activities for reconnected admin ${peer.id}:`, error);
            }

            return true;
        }
        catch (error) {
            console.error('WebSocketTransport: Error reconnecting admin:', error);
            return false;
        }
    }

    public async removeSubscription(peerId: string): Promise<void> {
        try {
            const subscription = this.subscriptions.get(peerId);
            if (!subscription) {
                return;
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
                    await this.state.removePeerFromChannel(channelId, peerId);
                }
                catch (error) {
                    console.error(`WebSocketTransport: Failed to remove peer from channel storage:`, error);
                }
            }

            this.subscriptions.delete(peerId);

            const peerKeys = Array.from(this.lastMessageTimes.keys())
                .filter(key => key.includes(peerId));
            peerKeys.forEach(key => this.lastMessageTimes.delete(key));

            try {
                await this.state.deleteSubscription(peerId);
            }
            catch (error) {
                console.error(`WebSocketTransport: Failed to delete subscription from storage:`, error);
            }
        }
        catch (error) {
            console.error('WebSocketTransport: Error unsubscribing admin:', error);
            throw error;
        }
    }

    public getSubscription(peerId: string): PersistedSubscription | undefined {
        return this.subscriptions.get(peerId);
    }

    private async broadcastLogBatch(logs: LoggerObject[]): Promise<void> {
        if (!logs || logs.length === 0) {
            return;
        }

        const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const originalLength = logs.length;

        for (const [channelId, channel] of this.channels.entries()) {
            if (channel.subscribers.size === 0) {
                continue;
            }

            if (!this.shouldSendMessage(channelId)) {
                continue;
            }

            channel.last_activity = new Date().getTime();

            if (Math.random() < 0.1) {
                this.state.updateChannelActivity(channelId).catch((error: unknown) => {
                    console.error(`WebSocketTransport: Failed to update channel activity:`, error);
                });
            }

            const subscriberGroups = this.groupSubscribersByFilters(channel);

            for (const [filterKey, subscriberGroup] of subscriberGroups.entries()) {
                const { peers, filters } = subscriberGroup;

                const filteredLogs = this.filterLogBatch(logs, filters);

                if (filteredLogs.length === 0) {
                    continue;
                }

                const sendPromises = peers.map(({ peerId, peer }) => {
                    const subscription = this.subscriptions.get(peerId);
                    if (subscription) {
                        subscription.last_activity = new Date().getTime();
                        this.subscriptions.set(peerId, subscription);
                        this.state.updateSubscriptionActivity(peerId).catch((error: unknown) => {
                            console.error(`WebSocketTransport: Failed to update subscription activity for ${peerId}:`, error);
                        });
                    }

                    if (!peer || !peer.websocket) {
                        channel.subscribers.delete(peerId);
                        return Promise.resolve();
                    }

                    return this.sendLogBatchToPeer(peer, filteredLogs, channelId, {
                        batchId,
                        originalLength,
                        filtered: filteredLogs.length < originalLength
                    }).catch(error => {
                        console.error(`WebSocketTransport: Error sending log batch to peer ${peerId}:`, error);
                    });
                });

                await Promise.allSettled(sendPromises);
            }
        }
    }

    private groupSubscribersByFilters(channel: PersistedChannel): Map<string, {
        peers: Array<{ peerId: string; peer: Peer }>;
        filters?: SubscriptionFilter;
    }> {
        const groups = new Map<string, {
            peers: Array<{ peerId: string; peer: Peer }>;
            filters?: SubscriptionFilter;
        }>();

        for (const [peerId, peer] of channel.subscribers) {
            const subscription = this.subscriptions.get(peerId);
            const filters = subscription?.filters;

            const filterKey = this.createFilterKey(filters);

            if (!groups.has(filterKey)) {
                groups.set(filterKey, {
                    peers: [],
                    filters
                });
            }

            groups.get(filterKey)!.peers.push({ peerId, peer });
        }

        return groups;
    }

    private createFilterKey(filters?: SubscriptionFilter): string {
        if (!filters) {
            return 'no-filter';
        }

        const parts: string[] = [];

        if (filters.level !== undefined) {
            if (Array.isArray(filters.level)) {
                // For arrays, create a stable key by sorting the serialized values
                const levelKeys = filters.level.map(level => {
                    if (typeof level === 'number') return `n${level}`;
                    return `s${level}`;
                }).sort();
                parts.push(`level:${levelKeys.join(',')}`);
            } else {
                // Single level value
                const levelKey = typeof filters.level === 'number'
                    ? `n${filters.level}`
                    : `s${filters.level}`;
                parts.push(`level:${levelKey}`);
            }
        }

        if (filters.source && filters.source.length > 0) {
            parts.push(`source:${filters.source.sort().join(',')}`);
        }

        if (filters.tags && filters.tags.length > 0) {
            parts.push(`tags:${filters.tags.sort().join(',')}`);
        }

        return parts.length > 0 ? parts.join('|') : 'no-filter';
    }

    private filterLogBatch(logs: LoggerObject[], filters?: SubscriptionFilter): LoggerObject[] {
        if (!filters) {
            return logs;
        }

        return logs.filter(logObj => this.passesFilter(logObj, filters));
    }

    private async sendLogBatchToPeer(
        peer: Peer,
        logs: LoggerObject[],
        channelId: string,
        meta: {
            batchId?: string;
            originalLength?: number;
            filtered?: boolean;
        }
    ): Promise<void> {
        try {
            const message: LogMessage = {
                type: 'log',
                channel: channelId,
                timestamp: new Date().toISOString(),
                data: logs,
                meta: {
                    length: logs.length,
                    ...meta
                }
            };

            await peer.send(JSON.stringify(message));
        }
        catch (error) {
            console.error('WebSocketTransport: Failed to send batch message to peer:', error);
            throw error;
        }
    }

    private passesFilter(logObj: LoggerObject, filters: SubscriptionFilter): boolean {
        if (filters.level !== undefined) {
            if (logObj.lvl === undefined || logObj.type === undefined) {
                return false;
            }

            if (Array.isArray(filters.level)) {
                const matchesAny = filters.level.some(levelInput =>
                    LogLevelParser.matchesFilter(logObj.type, logObj.lvl, levelInput)
                );
                if (!matchesAny) {
                    return false;
                }
            } else {
                if (!LogLevelParser.matchesFilter(logObj.type, logObj.lvl, filters.level)) {
                    return false;
                }
            }
        }

        if (filters.source && filters.source.length > 0) {
            if (!filters.source.includes(logObj.source?.name || '')) {
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
                console.error('WebSocketTransport: Error in cleanup interval:', err)
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

        this.cleanupOrphanedRateLimits();

        this.state.cleanup().catch((error: unknown) => {
            console.error('WebSocketTransport: Storage cleanup failed:', error);
        });
    }

    private cleanupOrphanedRateLimits(): void {
        const activeChannelIds = new Set(this.channels.keys());
        const orphanedKeys: string[] = [];

        for (const channelId of this.lastMessageTimes.keys()) {
            if (!activeChannelIds.has(channelId)) {
                orphanedKeys.push(channelId);
            }
        }

        if (orphanedKeys.length > 0) {
            console.log(
                '%cFROGGER', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                `🐸 Cleaned up ${orphanedKeys.length} orphaned rate limit entries`
            );

            for (const key of orphanedKeys) {
                this.lastMessageTimes.delete(key);
            }
        }
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

            this.lastMessageTimes.delete(channelId);

            if (deleteFromStorage) {
                try {
                    await this.state.deleteChannel(channelId);
                } catch (error) {
                    console.error(`WebSocketLogReporter: Failed to delete channel from state:`, error);
                }
            }

            console.log(
                '🐸 \x1b[32mFROGGER\x1b[0m',
                `Websocket channel '${channelId}' has been destroyed`
            );
        }
        catch (error) {
            console.error(`WebSocketTransport: Error cleaning up channel ${channelId}:`, error);
            this.channels.delete(channelId);
            this.lastMessageTimes.delete(channelId);
        }
    }

    private async cleanupPeer(peer: Peer, peerId: string): Promise<void> {
        try {
            if (peer.websocket) {
                await peer.close(1000, 'Channel cleanup');
            }
        }
        catch (error) {
            console.error('WebSocketTransport: Error closing peer connection:', error);
        }

        await this.removeSubscription(peerId);
    }

    public async getStatus(): Promise<{
        channels: number;
        totalSubscribers: number;
        activeSubscriptions: number;
        state: any;
        channelDetails: Array<{
            uuid: string;
            subscribers: number;
            created_at: number;
            last_activity: number;
        }>;
        rateLimitEntries: number;
        orphanedRateLimits: number;
    }> {
        const channelDetails = Array.from(this.channels.values()).map(channel => ({
            uuid: channel.channel_uuid,
            subscribers: channel.subscribers.size,
            created_at: channel.created_at,
            last_activity: channel.last_activity
        }));

        const totalSubscribers = Array.from(this.channels.values())
            .reduce((sum, channel) => sum + channel.subscribers.size, 0);

        const stateStats = await this.state.getStorageStats().catch(() => ({
            totalChannels: 0,
            totalSubscriptions: 0,
            channelsWithPeers: 0,
            orphanedPeerMappings: 0
        }));

        const activeChannelIds = new Set(this.channels.keys());
        const orphanedRateLimits = Array.from(this.lastMessageTimes.keys())
            .filter(channelId => !activeChannelIds.has(channelId))
            .length;

        return {
            channels: this.channels.size,
            totalSubscribers,
            activeSubscriptions: this.subscriptions.size,
            state: stateStats,
            channelDetails,
            rateLimitEntries: this.lastMessageTimes.size,
            orphanedRateLimits
        };
    }

    public async getPersistedChannels(): Promise<PersistedChannel[]> {
        return await this.state.getAllChannels();
    }

    public async getPersistedSubscriptions(): Promise<PersistedSubscription[]> {
        return await this.state.getAllSubscriptions();
    }

    public getFilterDescription(filters?: SubscriptionFilter): string {
        if (!filters) {
            return 'No filters (all logs)';
        }

        const parts: string[] = [];

        if (filters.level !== undefined) {
            if (Array.isArray(filters.level)) {
                const descriptions = filters.level.map(level => {
                    try {
                        return LogLevelParser.describe(level);
                    } catch {
                        return `Invalid: ${level}`;
                    }
                });
                parts.push(`Levels: ${descriptions.join(', ')}`);
            } else {
                try {
                    parts.push(`Levels: ${LogLevelParser.describe(filters.level)}`);
                } catch {
                    parts.push(`Levels: Invalid (${filters.level})`);
                }
            }
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