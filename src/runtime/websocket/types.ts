import type { Peer } from 'crossws';
import type { LoggerObject } from '../shared/types/log';

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


// Websocket communication
export enum MessageType {
    Ping = 'ping',
    Pong = 'pong',
    Connected = 'connected',
    Error = 'error',
}


export enum WebSocketMessageAuthor {
    Client = 'client',
    Server = 'server'
}


export interface WebSocketMessage<T> {
    from: WebSocketMessageAuthor,
    type: T,
    channel?: string,
    data?: any
}

export enum WebSocketStatus {
    Connecting = 'connecting',
    Open = 'open',
    Closed = 'closed',
    Timeout = 'timeout',
}

export interface LogMessage {
    type: 'log';
    channel: string;
    timestamp: string;
    data: LoggerObject[];
    meta: {
        length: number;
        batchId?: string;
        originalLength?: number;
        filtered?: boolean;
    };
}