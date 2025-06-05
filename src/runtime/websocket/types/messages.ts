import type { SubscriptionFilter, LogWebSocketMessage } from "../types";
import type { LoggerObject } from "../../shared/types/log";



export interface HistoricalLogMessage extends LogWebSocketMessage {
    type: 'load_historical' | 'search_logs' | 'get_log_range' | 'cancel_query';
    data: HistoricalLogRequestData;
}

export interface HistoricalLogRequestData {
    channel: string;
    queryId?: string;
    
    startTime?: number;
    endTime?: number;
    
    limit?: number;
    offset?: number;
    reverse?: boolean;
    
    search?: {
        traceId?: string;
        spanId?: string;
        source?: string;
        tags?: string[];
        message?: string;
        level?: number | string[];
    };
    
    filters?: SubscriptionFilter;
    
    streaming?: boolean;
    chunkSize?: number;
    maxResults?: number;
    
    timeout?: number;
    priority?: 'low' | 'normal' | 'high';
}

export interface HistoricalLogResponse {
    type: 'historical_data' | 'historical_chunk' | 'historical_complete' | 'historical_error';
    channel: string;
    timestamp: string;
    data: LoggerObject[];
    meta: HistoricalLogResponseMeta;
}

export interface HistoricalLogResponseMeta {
    queryId?: string;
    totalFound?: number;
    hasMore?: boolean;
    offset?: number;
    source?: 'file' | 'sqlite' | 'cache';
    
    chunkIndex?: number;
    totalChunks?: number;
    isLastChunk?: boolean;
    
    queryTimeMs?: number;
    filesProcessed?: number;
    cacheHit?: boolean;
    
    error?: {
        code: string;
        message: string;
        details?: any;
    };
}


export interface QueryCancellationMessage extends LogWebSocketMessage {
    type: 'cancel_query';
    data: {
        queryId: string;
        channel: string;
    };
}

export interface QueryStatusMessage {
    type: 'query_status';
    channel: string;
    timestamp: string;
    data: {
        queryId: string;
        status: 'running' | 'completed' | 'cancelled' | 'error';
        progress?: {
            filesProcessed: number;
            totalFiles: number;
            logsFound: number;
            estimatedTimeRemainingMs?: number;
        };
    };
}

export interface StorageStatusMessage {
    type: 'storage_status';
    channel: string;
    timestamp: string;
    data: {
        type: string;
        initialized: boolean;
        healthy: boolean;
        totalLogs?: number;
        availableFiles?: string[];
        dateRange?: { start: string; end: string };
        performance: {
        queriesExecuted: number;
        averageQueryTimeMs: number;
        cacheHitRate: number;
        };
    };
}

export interface EnhancedSubscriptionConfirmation {
    type: 'subscription_confirmed';
    channel: string;
    timestamp: string;
    data: {
        peer_id: string;
        filters?: SubscriptionFilter;
        filter_description: string;
        
        storage_available: boolean;
        storage_type?: string;
        historical_search_enabled: boolean;
        max_query_limit?: number;
        supported_features: string[];
    };
}

export type AllWebSocketMessages = 
    | LogWebSocketMessage 
    | HistoricalLogMessage
    | QueryCancellationMessage
    | HistoricalLogResponse
    | QueryStatusMessage
    | StorageStatusMessage
    | EnhancedSubscriptionConfirmation;

export type WebSocketMessage = AllWebSocketMessages['type'];



export function isHistoricalLogMessage(message: any): message is HistoricalLogMessage {
    return message && typeof message === 'object' && 
        ['load_historical', 'search_logs', 'get_log_range', 'cancel_query'].includes(message.type);
}

export function isQueryCancellationMessage(message: any): message is QueryCancellationMessage {
    return message && typeof message === 'object' && message.type === 'cancel_query';
}

export function isHistoricalLogResponse(message: any): message is HistoricalLogResponse {
    return message && typeof message === 'object' && 
        ['historical_data', 'historical_chunk', 'historical_complete', 'historical_error'].includes(message.type);
}