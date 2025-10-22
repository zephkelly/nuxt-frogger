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



function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHistoricalLogMessage(message: unknown): message is HistoricalLogMessage {
    if (!isPlainObject(message)) {
        return false;
    }

    const validTypes = ['load_historical', 'search_logs', 'get_log_range', 'cancel_query'] as const;
    if (!validTypes.includes(message.type as any)) {
        return false;
    }

    if (!isPlainObject(message.data)) {
        return false;
    }

    if (typeof message.data.channel !== 'string') {
        return false;
    }

    return true;
}

export function isQueryCancellationMessage(message: unknown): message is QueryCancellationMessage {
    if (!isPlainObject(message)) {
        return false;
    }

    if (message.type !== 'cancel_query') {
        return false;
    }

    if (!isPlainObject(message.data)) {
        return false;
    }

    if (typeof message.data.queryId !== 'string' || typeof message.data.channel !== 'string') {
        return false;
    }

    return true;
}

export function isHistoricalLogResponse(message: unknown): message is HistoricalLogResponse {
    if (!isPlainObject(message)) {
        return false;
    }

    const validTypes = ['historical_data', 'historical_chunk', 'historical_complete', 'historical_error'] as const;
    if (!validTypes.includes(message.type as any)) {
        return false;
    }

    if (typeof message.channel !== 'string') {
        return false;
    }

    if (typeof message.timestamp !== 'string') {
        return false;
    }

    if (!Array.isArray(message.data)) {
        return false;
    }

    if (!isPlainObject(message.meta)) {
        return false;
    }

    return true;
}

export function isQueryStatusMessage(message: unknown): message is QueryStatusMessage {
    if (!isPlainObject(message)) {
        return false;
    }

    if (message.type !== 'query_status') {
        return false;
    }

    if (typeof message.channel !== 'string' || typeof message.timestamp !== 'string') {
        return false;
    }

    if (!isPlainObject(message.data)) {
        return false;
    }

    const data = message.data;
    if (typeof data.queryId !== 'string') {
        return false;
    }

    const validStatuses = ['running', 'completed', 'cancelled', 'error'] as const;
    if (!validStatuses.includes(data.status as any)) {
        return false;
    }

    if (data.progress !== undefined) {
        if (!isPlainObject(data.progress)) {
            return false;
        }
        const progress = data.progress;
        if (
            typeof progress.filesProcessed !== 'number' ||
            typeof progress.totalFiles !== 'number' ||
            typeof progress.logsFound !== 'number'
        ) {
            return false;
        }
    }

    return true;
}

export function isStorageStatusMessage(message: unknown): message is StorageStatusMessage {
    if (!isPlainObject(message)) {
        return false;
    }

    if (message.type !== 'storage_status') {
        return false;
    }

    if (typeof message.channel !== 'string' || typeof message.timestamp !== 'string') {
        return false;
    }

    if (!isPlainObject(message.data)) {
        return false;
    }

    const data = message.data;
    if (
        typeof data.type !== 'string' ||
        typeof data.initialized !== 'boolean' ||
        typeof data.healthy !== 'boolean'
    ) {
        return false;
    }

    if (!isPlainObject(data.performance)) {
        return false;
    }

    const performance = data.performance;
    if (
        typeof performance.queriesExecuted !== 'number' ||
        typeof performance.averageQueryTimeMs !== 'number' ||
        typeof performance.cacheHitRate !== 'number'
    ) {
        return false;
    }

    return true;
}

export function isEnhancedSubscriptionConfirmation(message: unknown): message is EnhancedSubscriptionConfirmation {
    if (!isPlainObject(message)) {
        return false;
    }

    if (message.type !== 'subscription_confirmed') {
        return false;
    }

    if (typeof message.channel !== 'string' || typeof message.timestamp !== 'string') {
        return false;
    }

    if (!isPlainObject(message.data)) {
        return false;
    }

    const data = message.data;
    if (
        typeof data.peer_id !== 'string' ||
        typeof data.filter_description !== 'string' ||
        typeof data.storage_available !== 'boolean' ||
        typeof data.historical_search_enabled !== 'boolean' ||
        !Array.isArray(data.supported_features)
    ) {
        return false;
    }

    return true;
}