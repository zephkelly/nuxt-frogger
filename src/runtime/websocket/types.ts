import type { Peer } from 'crossws';
import type { LoggerObject } from '../shared/types/log';
import type { LogLevelInput } from '../shared/utils/log-level-parser';
import type { LogType } from 'consola';

export interface SubscriptionFilter {
    level?: LogLevelInput | LogLevelInput[];
    type?: LogType | LogType[];
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


export interface IWebSocketTransport {
    subscribe(peer: Peer, channel: string, filters?: SubscriptionFilter): Promise<boolean>;
    removeSubscription(peerId: string): Promise<void>;
    getSubscription(peerId: string): any;
    getStatus(): Promise<any>;
    getFilterDescription(filters?: SubscriptionFilter): string;
}

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