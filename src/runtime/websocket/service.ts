import { Peer } from "crossws";
import type { IReporter } from "../shared/types/internal-reporter";
import type { LoggerObject } from "../shared/types/log";

import type { LogChannel, SubscriptionFilter, AdminSubscription } from "./types";




export class WebSocketLogReporter implements IReporter {
    public readonly name = 'WebSocketLogReporter';
    public readonly reporterId: string;

    private static instance: WebSocketLogReporter | null = null;
    private channels: Map<string, LogChannel> = new Map();
    private adminSubscriptions: Map<string, AdminSubscription> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    private readonly CLEANUP_INTERVAL = 1000 * 60 * 5;
    private readonly STALE_CHANNEL_TIMEOUT = 1000 * 60 * 30;
    private readonly MESSAGE_RATE_LIMIT = 100;
    private lastMessageTimes: Map<string, number> = new Map();

    private constructor() {
        this.reporterId = `websocket-reporter-${Date.now()}`;
        this.startCleanupInterval();
    }

    public static getInstance(): WebSocketLogReporter {
        if (!WebSocketLogReporter.instance) {
            WebSocketLogReporter.instance = new WebSocketLogReporter();
        }
        return WebSocketLogReporter.instance;
    }

    public static async destroyInstance(): Promise<void> {
        if (WebSocketLogReporter.instance) {
            await WebSocketLogReporter.instance.destroy();
            WebSocketLogReporter.instance = null;
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
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            const cleanupPromises = Array.from(this.channels.keys()).map(
                channelId => this.cleanupChannel(channelId)
            );

            await Promise.allSettled(cleanupPromises);

            this.channels.clear();
            this.adminSubscriptions.clear();
            this.lastMessageTimes.clear();

            console.log('WebSocketLogReporter: Shutdown complete');
        } catch (error) {
            console.error('WebSocketLogReporter: Error during shutdown:', error);
            throw error;
        }
    }

    public createChannel(channelId: string): LogChannel {
        if (this.channels.has(channelId)) {
            return this.channels.get(channelId)!;
        }

        const channel: LogChannel = {
            channel_id: channelId,
            subscribers: new Map(),
            created_at: new Date(),
            last_activity: new Date()
        };

        this.channels.set(channelId, channel);
        console.log(`WebSocketLogReporter: Channel ${channelId} created`);
        return channel;
    }

    public getChannel(channelId: string): LogChannel | undefined {
        return this.channels.get(channelId);
    }

    public getChannels(): LogChannel[] {
        return Array.from(this.channels.values());
    }

    public async subscribeAdminToChannel(
        peer: Peer, 
        channelId: string, 
        filters?: SubscriptionFilter
    ): Promise<boolean> {
        try {
            const channel = this.createChannel(channelId);

            await this.unsubscribeAdmin(peer.id);

            channel.subscribers.set(peer.id, peer);
            channel.last_activity = new Date();

            const subscription: AdminSubscription = {
                peer_id: peer.id,
                channels: [channelId],
                filters,
                subscribed_at: new Date()
            };

            this.adminSubscriptions.set(peer.id, subscription);

            console.log(`WebSocketLogReporter: Admin ${peer.id} subscribed to channel ${channelId}`);
            return true;
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error subscribing admin to channel:', error);
            return false;
        }
    }

    public async unsubscribeAdmin(peerId: string): Promise<boolean> {
        try {
            const subscription = this.adminSubscriptions.get(peerId);
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
            }

            this.adminSubscriptions.delete(peerId);
            
            const peerKeys = Array.from(this.lastMessageTimes.keys())
                .filter(key => key.includes(peerId));
            peerKeys.forEach(key => this.lastMessageTimes.delete(key));

            console.log(`WebSocketLogReporter: Admin ${peerId} unsubscribed`);
            return true;
        }
        catch (error) {
            console.error('WebSocketLogReporter: Error unsubscribing admin:', error);
            return false;
        }
    }

    public getAdminSubscription(peerId: string): AdminSubscription | undefined {
        return this.adminSubscriptions.get(peerId);
    }

    private broadcastLog(logObj: LoggerObject): void {
        for (const [channelId, channel] of this.channels.entries()) {
            if (channel.subscribers.size === 0) {
                continue;
            }

            if (!this.shouldSendMessage(channelId)) {
                continue;
            }

            channel.last_activity = new Date();

            for (const [peerId, peer] of channel.subscribers) {
                const subscription = this.adminSubscriptions.get(peerId);
                
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
        } catch (error) {
            console.error('WebSocketLogReporter: Failed to send message to peer:', error);
            throw error;
        }
    }

    private passesFilter(logObj: LoggerObject, filters: SubscriptionFilter): boolean {
        if (filters.level && filters.level.length > 0) {
            if (!filters.level.includes(logObj.lvl.toString())) {
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
            const timeSinceActivity = now.getTime() - channel.last_activity.getTime();
            
            if (channel.subscribers.size === 0 || timeSinceActivity > this.STALE_CHANNEL_TIMEOUT) {
                cleanupPromises.push(this.cleanupChannel(channelId));
            }
        }

        await Promise.allSettled(cleanupPromises);
    }

    private async cleanupChannel(channelId: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) return;

        try {
            // Close all subscriber connections
            const cleanupPromises: Promise<void>[] = [];
            
            for (const [peerId, peer] of channel.subscribers) {
                cleanupPromises.push(this.cleanupPeer(peer, peerId));
            }

            await Promise.allSettled(cleanupPromises);

            channel.subscribers.clear();
            this.channels.delete(channelId);

            console.log(`WebSocketLogReporter: Channel ${channelId} cleaned up`);
        } catch (error) {
            console.error(`WebSocketLogReporter: Error cleaning up channel ${channelId}:`, error);
            this.channels.delete(channelId);
        }
    }

    private async cleanupPeer(peer: Peer, peerId: string): Promise<void> {
        try {
            if (peer.websocket) {
                await peer.close(1000, 'Channel cleanup');
            }
        } catch (error) {
            console.error('WebSocketLogReporter: Error closing peer connection:', error);
        }

        await this.unsubscribeAdmin(peerId);
    }

    public getStatus(): {
        channels: number;
        totalSubscribers: number;
        activeSubscriptions: number;
        channelDetails: Array<{
            id: string;
            subscribers: number;
            created_at: Date;
            last_activity: Date;
        }>;
    } {
        const channelDetails = Array.from(this.channels.values()).map(channel => ({
            id: channel.channel_id,
            subscribers: channel.subscribers.size,
            created_at: channel.created_at,
            last_activity: channel.last_activity
        }));

        const totalSubscribers = Array.from(this.channels.values())
            .reduce((sum, channel) => sum + channel.subscribers.size, 0);

        return {
            channels: this.channels.size,
            totalSubscribers,
            activeSubscriptions: this.adminSubscriptions.size,
            channelDetails
        };
    }
}