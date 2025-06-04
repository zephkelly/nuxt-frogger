import type { SubscriptionFilter } from "../types";


export interface PersistedChannel {
    channel_id: string;
    created_at: string;
    last_activity: string;
    subscriber_count: number;
    metadata?: Record<string, any>;
}

export interface PersistedSubscription {
    peer_id: string;
    channels: string[];
    filters?: SubscriptionFilter;
    subscribed_at: string;
    last_activity: string;
}

export interface IWebSocketStorage {
    getChannel(channelId: string): Promise<PersistedChannel | null>;
    setChannel(channelId: string, channel: PersistedChannel, ttl?: number): Promise<void>;
    deleteChannel(channelId: string): Promise<void>;
    getAllChannels(): Promise<PersistedChannel[]>;
    
    getSubscription(peerId: string): Promise<PersistedSubscription | null>;
    setSubscription(peerId: string, subscription: PersistedSubscription, ttl?: number): Promise<void>;
    deleteSubscription(peerId: string): Promise<void>;
    getAllSubscriptions(): Promise<PersistedSubscription[]>;
    
    addPeerToChannel(channelId: string, peerId: string): Promise<void>;
    removePeerFromChannel(channelId: string, peerId: string): Promise<void>;
    getChannelPeers(channelId: string): Promise<string[]>;
    
    cleanup(): Promise<void>;
    updateChannelActivity(channelId: string): Promise<void>;
    updateSubscriptionActivity(peerId: string): Promise<void>;
}