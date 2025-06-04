import { Peer } from "crossws";



export interface LogChannel {
    channel_id: string;
    subscribers: Map<string, Peer>;
    created_at: Date;
    last_activity: Date;
}

export interface SubscriptionFilter {
    level?: string[];
    source?: string[];
    tags?: string[];
}

export interface AdminSubscription {
    peer_id: string;
    channels: string[];
    filters?: SubscriptionFilter;
    subscribed_at: Date;
}