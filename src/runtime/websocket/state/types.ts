import type { PersistedChannel, PersistedSubscription } from "../types";



export interface IWebSocketStateStorage {
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

    getStorageStats(): Promise<{
        totalChannels: number;
        totalSubscriptions: number;
        channelsWithPeers: number;
        orphanedPeerMappings: number;
    }>
}