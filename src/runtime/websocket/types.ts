import type { Peer } from 'crossws';


export interface SubscriptionFilter {
    level?: string[];
    source?: string[];
    tags?: string[];
}

export interface PersistedChannel {
    channel_uuid: string;
    created_at: number;
    last_activity: number;
    subscribers: Map<string, Peer>;
    metadata?: Record<string, any>;
}

export interface PersistedSubscription {
    peer_id: string;
    channels: string[];
    filters?: SubscriptionFilter;
    subscribed_at: number;
    last_activity: number;
}


// Websocket handler
export interface FroggerWebSocketOptions {
    upgrade?: (request: Request) => Promise<boolean> | boolean;
}

export interface LogWebSocketParams {
    channel?: string;
    filters?: SubscriptionFilter;
}

export interface LogWebSocketMessage {
    type: string;
    channel?: string;
    data?: any;
}