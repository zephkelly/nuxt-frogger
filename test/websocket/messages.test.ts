import { describe, it, expect } from 'vitest';
import {
    isHistoricalLogMessage,
    isQueryCancellationMessage,
    isHistoricalLogResponse,
    type HistoricalLogMessage,
    type QueryCancellationMessage,
    type HistoricalLogResponse,
    type QueryStatusMessage,
    isQueryStatusMessage,
    type StorageStatusMessage,
    isStorageStatusMessage,
    type EnhancedSubscriptionConfirmation,
    isEnhancedSubscriptionConfirmation
} from '../../src/runtime/websocket/types/messages';

describe('Improved WebSocket Message Type Guards', () => {
    describe('isHistoricalLogMessage', () => {
        describe('valid messages', () => {
            it('should return true for load_historical message with required fields', () => {
                const message: HistoricalLogMessage = {
                    type: 'load_historical',
                    data: {
                        channel: 'test-channel',
                        startTime: 1000,
                        endTime: 2000
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(true);
            });

            it('should return true for search_logs message', () => {
                const message: HistoricalLogMessage = {
                    type: 'search_logs',
                    data: {
                        channel: 'test-channel',
                        search: {
                            traceId: 'trace-123',
                            message: 'error'
                        }
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(true);
            });

            it('should return true for get_log_range message', () => {
                const message: HistoricalLogMessage = {
                    type: 'get_log_range',
                    data: {
                        channel: 'test-channel',
                        limit: 100,
                        offset: 0
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(true);
            });

            it('should return true for cancel_query message', () => {
                const message: HistoricalLogMessage = {
                    type: 'cancel_query',
                    data: {
                        channel: 'test-channel',
                        queryId: 'query-123'
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(true);
            });

            it('should return true for message with all optional fields', () => {
                const message: HistoricalLogMessage = {
                    type: 'search_logs',
                    data: {
                        channel: 'test-channel',
                        queryId: 'q1',
                        startTime: 1000,
                        endTime: 2000,
                        limit: 100,
                        offset: 0,
                        reverse: true,
                        search: {
                            traceId: 'trace-123',
                            spanId: 'span-456',
                            source: 'api',
                            tags: ['error', 'critical'],
                            message: 'timeout',
                            level: ['error', 'fatal']
                        },
                        streaming: true,
                        chunkSize: 1000,
                        maxResults: 5000,
                        timeout: 30000,
                        priority: 'high'
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isHistoricalLogMessage(null)).toBe(false);
            });

            it('should return false for undefined', () => {
                expect(isHistoricalLogMessage(undefined)).toBe(false);
            });

            it('should return false for primitive types', () => {
                expect(isHistoricalLogMessage('string')).toBe(false);
                expect(isHistoricalLogMessage(123)).toBe(false);
                expect(isHistoricalLogMessage(true)).toBe(false);
            });

            it('should return false for arrays', () => {
                expect(isHistoricalLogMessage([])).toBe(false);
                expect(isHistoricalLogMessage([{ type: 'load_historical' }])).toBe(false);
            });

            it('should return false for invalid type', () => {
                const message = {
                    type: 'invalid_type',
                    data: { channel: 'test' }
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when data is missing', () => {
                const message = {
                    type: 'load_historical'
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when data is not an object', () => {
                const message = {
                    type: 'load_historical',
                    data: 'not an object'
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when data is null', () => {
                const message = {
                    type: 'load_historical',
                    data: null
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when data is an array', () => {
                const message = {
                    type: 'load_historical',
                    data: []
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when channel is missing', () => {
                const message = {
                    type: 'load_historical',
                    data: {
                        startTime: 1000
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when channel is not a string', () => {
                const message = {
                    type: 'load_historical',
                    data: {
                        channel: 123
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });

            it('should return false when channel is null', () => {
                const message = {
                    type: 'load_historical',
                    data: {
                        channel: null
                    }
                };
                expect(isHistoricalLogMessage(message)).toBe(false);
            });
        });
    });

    describe('isQueryCancellationMessage', () => {
        describe('valid messages', () => {
            it('should return true for valid cancel_query message', () => {
                const message: QueryCancellationMessage = {
                    type: 'cancel_query',
                    data: {
                        queryId: 'query-123',
                        channel: 'test-channel'
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(true);
            });

            it('should return true for cancel_query with empty strings', () => {
                const message = {
                    type: 'cancel_query',
                    data: {
                        queryId: '',
                        channel: ''
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isQueryCancellationMessage(null)).toBe(false);
            });

            it('should return false for undefined', () => {
                expect(isQueryCancellationMessage(undefined)).toBe(false);
            });

            it('should return false for primitive types', () => {
                expect(isQueryCancellationMessage('cancel_query')).toBe(false);
                expect(isQueryCancellationMessage(42)).toBe(false);
                expect(isQueryCancellationMessage(false)).toBe(false);
            });

            it('should return false for arrays', () => {
                expect(isQueryCancellationMessage([])).toBe(false);
            });

            it('should return false for wrong type', () => {
                const message = {
                    type: 'load_historical',
                    data: { queryId: 'q1', channel: 'ch1' }
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when data is missing', () => {
                const message = {
                    type: 'cancel_query'
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when data is not an object', () => {
                const message = {
                    type: 'cancel_query',
                    data: 'not an object'
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when data is null', () => {
                const message = {
                    type: 'cancel_query',
                    data: null
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when queryId is missing', () => {
                const message = {
                    type: 'cancel_query',
                    data: {
                        channel: 'test'
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when channel is missing', () => {
                const message = {
                    type: 'cancel_query',
                    data: {
                        queryId: 'q1'
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when queryId is not a string', () => {
                const message = {
                    type: 'cancel_query',
                    data: {
                        queryId: 123,
                        channel: 'test'
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });

            it('should return false when channel is not a string', () => {
                const message = {
                    type: 'cancel_query',
                    data: {
                        queryId: 'q1',
                        channel: 123
                    }
                };
                expect(isQueryCancellationMessage(message)).toBe(false);
            });
        });
    });

    describe('isHistoricalLogResponse', () => {
        describe('valid messages', () => {
            it('should return true for historical_data message', () => {
                const message: HistoricalLogResponse = {
                    type: 'historical_data',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {
                        queryId: 'query-123',
                        totalFound: 0
                    }
                };
                expect(isHistoricalLogResponse(message)).toBe(true);
            });

            it('should return true for historical_chunk message', () => {
                const message: HistoricalLogResponse = {
                    type: 'historical_chunk',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [{ level: 'info', message: 'test', timestamp: 123 } as any],
                    meta: {
                        chunkIndex: 1,
                        totalChunks: 5,
                        isLastChunk: false
                    }
                };
                expect(isHistoricalLogResponse(message)).toBe(true);
            });

            it('should return true for historical_complete message', () => {
                const message: HistoricalLogResponse = {
                    type: 'historical_complete',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {
                        queryId: 'query-123',
                        totalFound: 100,
                        queryTimeMs: 250
                    }
                };
                expect(isHistoricalLogResponse(message)).toBe(true);
            });

            it('should return true for historical_error message', () => {
                const message: HistoricalLogResponse = {
                    type: 'historical_error',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {
                        error: {
                            code: 'TIMEOUT',
                            message: 'Query timed out',
                            details: { timeout: 5000 }
                        }
                    }
                };
                expect(isHistoricalLogResponse(message)).toBe(true);
            });

            it('should return true for response with all meta fields', () => {
                const message: HistoricalLogResponse = {
                    type: 'historical_data',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {
                        queryId: 'q1',
                        totalFound: 50,
                        hasMore: true,
                        offset: 0,
                        source: 'sqlite',
                        chunkIndex: 0,
                        totalChunks: 1,
                        isLastChunk: true,
                        queryTimeMs: 100,
                        filesProcessed: 5,
                        cacheHit: true
                    }
                };
                expect(isHistoricalLogResponse(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isHistoricalLogResponse(null)).toBe(false);
            });

            it('should return false for undefined', () => {
                expect(isHistoricalLogResponse(undefined)).toBe(false);
            });

            it('should return false for primitive types', () => {
                expect(isHistoricalLogResponse('historical_data')).toBe(false);
                expect(isHistoricalLogResponse(100)).toBe(false);
                expect(isHistoricalLogResponse(true)).toBe(false);
            });

            it('should return false for arrays', () => {
                expect(isHistoricalLogResponse([])).toBe(false);
            });

            it('should return false for invalid type', () => {
                const message = {
                    type: 'load_historical',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when channel is missing', () => {
                const message = {
                    type: 'historical_data',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when channel is not a string', () => {
                const message = {
                    type: 'historical_data',
                    channel: 123,
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when timestamp is missing', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    data: [],
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when timestamp is not a string', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: 123,
                    data: [],
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when data is missing', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when data is not an array', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {},
                    meta: {}
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when meta is missing', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: []
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when meta is not an object', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: 'not an object'
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });

            it('should return false when meta is null', () => {
                const message = {
                    type: 'historical_data',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: [],
                    meta: null
                };
                expect(isHistoricalLogResponse(message)).toBe(false);
            });
        });
    });

    describe('isQueryStatusMessage', () => {
        describe('valid messages', () => {
            it('should return true for valid query_status message without progress', () => {
                const message: QueryStatusMessage = {
                    type: 'query_status',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'query-123',
                        status: 'running'
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(true);
            });

            it('should return true for all status values', () => {
                const statuses: Array<'running' | 'completed' | 'cancelled' | 'error'> =
                    ['running', 'completed', 'cancelled', 'error'];

                statuses.forEach(status => {
                    const message: QueryStatusMessage = {
                        type: 'query_status',
                        channel: 'test-channel',
                        timestamp: '2025-01-01T00:00:00Z',
                        data: {
                            queryId: 'query-123',
                            status
                        }
                    };
                    expect(isQueryStatusMessage(message)).toBe(true);
                });
            });

            it('should return true with valid progress object', () => {
                const message: QueryStatusMessage = {
                    type: 'query_status',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'query-123',
                        status: 'running',
                        progress: {
                            filesProcessed: 5,
                            totalFiles: 10,
                            logsFound: 100,
                            estimatedTimeRemainingMs: 5000
                        }
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(true);
            });

            it('should return true with progress without optional estimatedTimeRemainingMs', () => {
                const message: QueryStatusMessage = {
                    type: 'query_status',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'query-123',
                        status: 'completed',
                        progress: {
                            filesProcessed: 10,
                            totalFiles: 10,
                            logsFound: 500
                        }
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isQueryStatusMessage(null)).toBe(false);
            });

            it('should return false for wrong type', () => {
                const message = {
                    type: 'query_status_wrong',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: { queryId: 'q1', status: 'running' }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when channel is not a string', () => {
                const message = {
                    type: 'query_status',
                    channel: 123,
                    timestamp: '2025-01-01T00:00:00Z',
                    data: { queryId: 'q1', status: 'running' }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when timestamp is not a string', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: 123,
                    data: { queryId: 'q1', status: 'running' }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when data is not an object', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: 'not an object'
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when queryId is not a string', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: { queryId: 123, status: 'running' }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false for invalid status', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: { queryId: 'q1', status: 'invalid' }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when progress is not an object', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'q1',
                        status: 'running',
                        progress: 'not an object'
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when progress.filesProcessed is not a number', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'q1',
                        status: 'running',
                        progress: {
                            filesProcessed: '5',
                            totalFiles: 10,
                            logsFound: 100
                        }
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when progress.totalFiles is not a number', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'q1',
                        status: 'running',
                        progress: {
                            filesProcessed: 5,
                            totalFiles: '10',
                            logsFound: 100
                        }
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });

            it('should return false when progress.logsFound is not a number', () => {
                const message = {
                    type: 'query_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        queryId: 'q1',
                        status: 'running',
                        progress: {
                            filesProcessed: 5,
                            totalFiles: 10,
                            logsFound: '100'
                        }
                    }
                };
                expect(isQueryStatusMessage(message)).toBe(false);
            });
        });
    });

    describe('isStorageStatusMessage', () => {
        describe('valid messages', () => {
            it('should return true for valid storage_status message', () => {
                const message: StorageStatusMessage = {
                    type: 'storage_status',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(true);
            });

            it('should return true with all optional fields', () => {
                const message: StorageStatusMessage = {
                    type: 'storage_status',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        totalLogs: 10000,
                        availableFiles: ['log1.db', 'log2.db'],
                        dateRange: { start: '2025-01-01', end: '2025-01-31' },
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isStorageStatusMessage(null)).toBe(false);
            });

            it('should return false for wrong type', () => {
                const message = {
                    type: 'storage_wrong',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when data.type is not a string', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 123,
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when initialized is not a boolean', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: 'true',
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when healthy is not a boolean', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: 1,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when performance is not an object', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: 'not an object'
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when performance.queriesExecuted is not a number', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: '100',
                            averageQueryTimeMs: 50,
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when performance.averageQueryTimeMs is not a number', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: '50',
                            cacheHitRate: 0.75
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });

            it('should return false when performance.cacheHitRate is not a number', () => {
                const message = {
                    type: 'storage_status',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        type: 'sqlite',
                        initialized: true,
                        healthy: true,
                        performance: {
                            queriesExecuted: 100,
                            averageQueryTimeMs: 50,
                            cacheHitRate: '0.75'
                        }
                    }
                };
                expect(isStorageStatusMessage(message)).toBe(false);
            });
        });
    });

    describe('isEnhancedSubscriptionConfirmation', () => {
        describe('valid messages', () => {
            it('should return true for valid subscription_confirmed message', () => {
                const message: EnhancedSubscriptionConfirmation = {
                    type: 'subscription_confirmed',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: true,
                        historical_search_enabled: true,
                        supported_features: ['search', 'filter', 'export']
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(true);
            });

            it('should return true with all optional fields', () => {
                const message: EnhancedSubscriptionConfirmation = {
                    type: 'subscription_confirmed',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filters: { level: ['error'] },
                        filter_description: 'Error logs only',
                        storage_available: true,
                        storage_type: 'sqlite',
                        historical_search_enabled: true,
                        max_query_limit: 10000,
                        supported_features: ['search', 'filter', 'export', 'streaming']
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(true);
            });

            it('should return true with empty supported_features array', () => {
                const message: EnhancedSubscriptionConfirmation = {
                    type: 'subscription_confirmed',
                    channel: 'test-channel',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: false,
                        historical_search_enabled: false,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(true);
            });
        });

        describe('invalid messages', () => {
            it('should return false for null', () => {
                expect(isEnhancedSubscriptionConfirmation(null)).toBe(false);
            });

            it('should return false for wrong type', () => {
                const message = {
                    type: 'subscription_wrong',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: true,
                        historical_search_enabled: true,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });

            it('should return false when peer_id is not a string', () => {
                const message = {
                    type: 'subscription_confirmed',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 123,
                        filter_description: 'All logs',
                        storage_available: true,
                        historical_search_enabled: true,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });

            it('should return false when filter_description is not a string', () => {
                const message = {
                    type: 'subscription_confirmed',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 123,
                        storage_available: true,
                        historical_search_enabled: true,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });

            it('should return false when storage_available is not a boolean', () => {
                const message = {
                    type: 'subscription_confirmed',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: 'true',
                        historical_search_enabled: true,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });

            it('should return false when historical_search_enabled is not a boolean', () => {
                const message = {
                    type: 'subscription_confirmed',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: true,
                        historical_search_enabled: 1,
                        supported_features: []
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });

            it('should return false when supported_features is not an array', () => {
                const message = {
                    type: 'subscription_confirmed',
                    channel: 'test',
                    timestamp: '2025-01-01T00:00:00Z',
                    data: {
                        peer_id: 'peer-123',
                        filter_description: 'All logs',
                        storage_available: true,
                        historical_search_enabled: true,
                        supported_features: 'not an array'
                    }
                };
                expect(isEnhancedSubscriptionConfirmation(message)).toBe(false);
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle messages with extra properties', () => {
            const message = {
                type: 'load_historical',
                data: { channel: 'test' },
                extraProperty: 'should not affect validation'
            };
            expect(isHistoricalLogMessage(message)).toBe(true);
        });

        it('should reject arrays even if they contain valid objects', () => {
            const messages = [{
                type: 'load_historical',
                data: { channel: 'test' }
            }];
            expect(isHistoricalLogMessage(messages)).toBe(false);
        });

        it('should handle deeply nested invalid data', () => {
            const message = {
                type: 'load_historical',
                data: {
                    channel: 'test',
                    search: {
                        level: [1, 2, 3] // valid - can be array of strings or number
                    }
                }
            };
            expect(isHistoricalLogMessage(message)).toBe(true);
        });
    });
});