import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketLogHandler } from '../../src/runtime/websocket/log-handler';
import type { Peer } from 'crossws';
import type { IWebSocketTransport, SubscriptionFilter } from '../../src/runtime/websocket/types';

// Mock Peer factory
function createMockPeer(id: string, url?: string): Peer {
    return {
        id,
        request: {
            url: url || `ws://localhost:3000/ws?channel=test-channel`,
        } as Request,
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        addr: '127.0.0.1',
        readyState: 1,
        url: url || 'ws://localhost:3000/ws',
    } as any;
}

// Mock WebSocketTransport
function createMockTransport(): IWebSocketTransport {
    return {
        subscribe: vi.fn().mockResolvedValue(true),
        removeSubscription: vi.fn().mockResolvedValue(undefined),
        getSubscription: vi.fn().mockReturnValue({
            peer_id: 'peer-1',
            channels: ['test-channel'],
            filters: undefined,
            subscribed_at: Date.now(),
            last_activity: Date.now(),
        }),
        getStatus: vi.fn().mockResolvedValue({
            channels: 1,
            totalSubscribers: 1,
            activeSubscriptions: 1,
        }),
        getFilterDescription: vi.fn().mockReturnValue('No filters (all logs)'),
    };
}

describe('WebSocketLogHandler', () => {
    let handler: WebSocketLogHandler;
    let mockTransport: IWebSocketTransport;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockTransport = createMockTransport();
        handler = new WebSocketLogHandler(mockTransport);
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        vi.clearAllMocks();
    });

    describe('handleOpen', () => {
        it('should successfully handle connection with channel parameter', async () => {
            const peer = createMockPeer('peer-1', 'ws://localhost:3000/ws?channel=test-channel');

            await handler.handleOpen(peer);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(peer, 'test-channel', undefined);
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"subscription_confirmed"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"channel":"test-channel"')
            );
        });

        it('should handle connection with channel and filters', async () => {
            const url = 'ws://localhost:3000/ws?channel=test-channel&level=error,fatal';
            const peer = createMockPeer('peer-2', url);

            await handler.handleOpen(peer);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'test-channel',
                expect.objectContaining({
                    level: ['error', 'fatal'],
                })
            );
        });

        it('should handle connection with type filters', async () => {
            const url = 'ws://localhost:3000/ws?channel=test-channel&type=log,error';
            const peer = createMockPeer('peer-3', url);

            await handler.handleOpen(peer);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'test-channel',
                expect.objectContaining({
                    type: ['log', 'error'],
                })
            );
        });

        it('should handle connection with source filters', async () => {
            const url = 'ws://localhost:3000/ws?channel=test-channel&sources=api,db';
            const peer = createMockPeer('peer-4', url);

            await handler.handleOpen(peer);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'test-channel',
                expect.objectContaining({
                    source: ['api', 'db'],
                })
            );
        });

        it('should handle connection with tag filters', async () => {
            const url = 'ws://localhost:3000/ws?channel=test-channel&tags=critical,security';
            const peer = createMockPeer('peer-5', url);

            await handler.handleOpen(peer);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'test-channel',
                expect.objectContaining({
                    tags: ['critical', 'security'],
                })
            );
        });

        it('should close connection if channel parameter is missing', async () => {
            const peer = createMockPeer('peer-6', 'ws://localhost:3000/ws');

            await handler.handleOpen(peer);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Channel parameter is required')
            );
            expect(peer.close).toHaveBeenCalledWith(1011);
        });

        it('should close connection if subscription fails', async () => {
            const peer = createMockPeer('peer-7', 'ws://localhost:3000/ws?channel=test-channel');
            vi.mocked(mockTransport.subscribe).mockResolvedValue(false);

            await handler.handleOpen(peer);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Failed to subscribe to log channel')
            );
            expect(peer.close).toHaveBeenCalledWith(1011);
        });

        it('should handle subscription errors', async () => {
            const peer = createMockPeer('peer-8', 'ws://localhost:3000/ws?channel=test-channel');
            vi.mocked(mockTransport.subscribe).mockRejectedValue(new Error('Subscription error'));

            await handler.handleOpen(peer);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] Connection error:',
                expect.any(Error)
            );
            expect(peer.close).toHaveBeenCalledWith(1011);
        });

        it('should include peer_id in subscription confirmation', async () => {
            const peer = createMockPeer('peer-9', 'ws://localhost:3000/ws?channel=test-channel');

            await handler.handleOpen(peer);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"peer_id":"peer-9"')
            );
        });

        it('should include filter description in subscription confirmation', async () => {
            const peer = createMockPeer('peer-10', 'ws://localhost:3000/ws?channel=test-channel&level=error');
            vi.mocked(mockTransport.getFilterDescription).mockReturnValue('Level: error and above');

            await handler.handleOpen(peer);

            expect(mockTransport.getFilterDescription).toHaveBeenCalled();
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Level: error and above')
            );
        });
    });

    describe('handleMessage', () => {
        it('should handle ping message', async () => {
            const peer = createMockPeer('peer-1');
            const message = { text: () => JSON.stringify({ type: 'ping' }) };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"pong"')
            );
        });

        it('should handle update_filters message', async () => {
            const peer = createMockPeer('peer-2');
            const filters: SubscriptionFilter = { level: ['error'] };
            const message = {
                text: () => JSON.stringify({
                    type: 'update_filters',
                    data: {
                        channel: 'test-channel',
                        filters,
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(peer, 'test-channel', filters);
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"filters_updated"')
            );
        });

        it('should handle update_filters failure', async () => {
            const peer = createMockPeer('peer-3');
            vi.mocked(mockTransport.subscribe).mockResolvedValue(false);
            const message = {
                text: () => JSON.stringify({
                    type: 'update_filters',
                    data: {
                        channel: 'test-channel',
                        filters: { level: ['info'] },
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Failed to update filters')
            );
        });

        it('should handle update_filters without channel', async () => {
            const peer = createMockPeer('peer-4');
            const message = {
                text: () => JSON.stringify({
                    type: 'update_filters',
                    data: {
                        filters: { level: ['info'] },
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Channel required for filter update')
            );
        });

        it('should handle get_status message', async () => {
            const peer = createMockPeer('peer-5');
            const message = { text: () => JSON.stringify({ type: 'get_status' }) };

            await handler.handleMessage(peer, message);

            expect(mockTransport.getSubscription).toHaveBeenCalledWith('peer-5');
            expect(mockTransport.getStatus).toHaveBeenCalled();
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"status"')
            );
        });

        it('should handle get_status with null subscription', async () => {
            const peer = createMockPeer('peer-6');
            vi.mocked(mockTransport.getSubscription).mockReturnValue(undefined);
            const message = { text: () => JSON.stringify({ type: 'get_status' }) };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"peer_subscription":null')
            );
        });

        it('should handle change_channel message', async () => {
            const peer = createMockPeer('peer-7');
            const message = {
                text: () => JSON.stringify({
                    type: 'change_channel',
                    data: {
                        channel: 'new-channel',
                        filters: { level: ['warn'] },
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'new-channel',
                { level: ['warn'] }
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"channel_changed"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"channel":"new-channel"')
            );
        });

        it('should handle change_channel without channel', async () => {
            const peer = createMockPeer('peer-8');
            const message = {
                text: () => JSON.stringify({
                    type: 'change_channel',
                    data: {
                        filters: { level: ['warn'] },
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Channel required for channel change')
            );
        });

        it('should handle change_channel failure', async () => {
            const peer = createMockPeer('peer-9');
            vi.mocked(mockTransport.subscribe).mockResolvedValue(false);
            const message = {
                text: () => JSON.stringify({
                    type: 'change_channel',
                    data: {
                        channel: 'new-channel',
                    },
                }),
            };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Failed to change channel')
            );
        });

        it('should handle unknown message type', async () => {
            const peer = createMockPeer('peer-10');
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const message = { text: () => JSON.stringify({ type: 'unknown_type' }) };

            await handler.handleMessage(peer, message);

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[Frogger] Unknown message type: unknown_type'
            );

            consoleWarnSpy.mockRestore();
        });

        it('should handle invalid JSON', async () => {
            const peer = createMockPeer('peer-11');
            const message = { text: () => 'invalid json' };

            await handler.handleMessage(peer, message);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] Message handling error:',
                expect.any(Error)
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Invalid message format')
            );
        });

        it('should handle errors in message processing', async () => {
            const peer = createMockPeer('peer-12');
            vi.mocked(mockTransport.getStatus).mockRejectedValue(new Error('Status error'));
            const message = { text: () => JSON.stringify({ type: 'get_status' }) };

            await handler.handleMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Status request failed')
            );
        });
    });

    describe('handleClose', () => {
        it('should remove subscription when connection closes', async () => {
            const peer = createMockPeer('peer-1');

            await handler.handleClose(peer);

            expect(mockTransport.removeSubscription).toHaveBeenCalledWith('peer-1');
        });

        it('should handle errors during close', async () => {
            const peer = createMockPeer('peer-2');
            vi.mocked(mockTransport.removeSubscription).mockRejectedValue(
                new Error('Removal error')
            );

            await handler.handleClose(peer);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] Close error:',
                expect.any(Error)
            );
        });

        it('should not throw if removeSubscription fails', async () => {
            const peer = createMockPeer('peer-3');
            vi.mocked(mockTransport.removeSubscription).mockRejectedValue(
                new Error('Removal error')
            );

            await expect(handler.handleClose(peer)).resolves.not.toThrow();
        });
    });

    describe('handleError', () => {
        it('should log error and remove subscription', async () => {
            const peer = createMockPeer('peer-1');
            const error = new Error('WebSocket error');

            await handler.handleError(peer, error);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] WebSocket error:',
                error
            );
            expect(mockTransport.removeSubscription).toHaveBeenCalledWith('peer-1');
        });

        it('should handle cleanup errors', async () => {
            const peer = createMockPeer('peer-2');
            const error = new Error('WebSocket error');
            vi.mocked(mockTransport.removeSubscription).mockRejectedValue(
                new Error('Cleanup error')
            );

            await handler.handleError(peer, error);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] WebSocket error:',
                error
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] Cleanup error:',
                expect.any(Error)
            );
        });
    });

    describe('extractParams', () => {
        it('should extract channel from URL', () => {
            const peer = createMockPeer('peer-1', 'ws://localhost:3000/ws?channel=my-channel');
            const params = handler.extractParams(peer);

            expect(params.channel).toBe('my-channel');
        });

        it('should extract multiple level filters', () => {
            const peer = createMockPeer(
                'peer-2',
                'ws://localhost:3000/ws?channel=test&level=error,fatal'
            );
            const params = handler.extractParams(peer);

            expect(params.filters?.level).toEqual(['error', 'fatal']);
        });

        it('should extract multiple type filters', () => {
            const peer = createMockPeer(
                'peer-3',
                'ws://localhost:3000/ws?channel=test&type=log,error'
            );
            const params = handler.extractParams(peer);

            expect(params.filters?.type).toEqual(['log', 'error']);
        });

        it('should extract multiple source filters', () => {
            const peer = createMockPeer(
                'peer-4',
                'ws://localhost:3000/ws?channel=test&sources=api,db'
            );
            const params = handler.extractParams(peer);

            expect(params.filters?.source).toEqual(['api', 'db']);
        });

        it('should extract multiple tag filters', () => {
            const peer = createMockPeer(
                'peer-5',
                'ws://localhost:3000/ws?channel=test&tags=critical,security'
            );
            const params = handler.extractParams(peer);

            expect(params.filters?.tags).toEqual(['critical', 'security']);
        });

        it('should handle missing URL with empty string fallback', () => {
            const peer = createMockPeer('peer-6', 'ws://localhost:3000/ws');
            const params = handler.extractParams(peer);

            expect(params).toBeDefined();
            expect(params.channel).toBeUndefined();
            expect(params.filters).toBeUndefined();
        });
    });

    describe('sendMessage', () => {
        it('should add timestamp to message', async () => {
            const peer = createMockPeer('peer-1');
            const message = { type: 'test', data: { foo: 'bar' } };

            await handler.sendMessage(peer, message);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"timestamp":"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"test"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"foo":"bar"')
            );
        });

        it('should send valid JSON', async () => {
            const peer = createMockPeer('peer-2');
            const message = { type: 'pong' };

            await handler.sendMessage(peer, message);

            const sentMessage = vi.mocked(peer.send).mock.calls[0][0] as string;
            expect(() => JSON.parse(sentMessage)).not.toThrow();
        });
    });

    describe('closeWithError', () => {
        it('should send error message and close connection', async () => {
            const peer = createMockPeer('peer-1');
            const errorMessage = 'Connection failed';

            await handler.closeWithError(peer, errorMessage);

            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"error"')
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('Connection failed')
            );
            expect(peer.close).toHaveBeenCalledWith(1011);
        });

        it('should handle errors during close', async () => {
            const peer = createMockPeer('peer-2');
            vi.mocked(peer.send).mockRejectedValue(new Error('Send error'));

            await handler.closeWithError(peer, 'Test error');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Frogger] Error closing peer:',
                expect.any(Error)
            );
        });
    });

    describe('routeMessage', () => {
        it('should route ping message to handlePing', async () => {
            const peer = createMockPeer('peer-1');
            const spy = vi.spyOn(handler, 'handlePing');

            await handler.routeMessage(peer, { type: 'ping' });

            expect(spy).toHaveBeenCalledWith(peer);
        });

        it('should route update_filters message to updateFilters', async () => {
            const peer = createMockPeer('peer-2');
            const spy = vi.spyOn(handler, 'updateFilters');
            const message = { type: 'update_filters', data: { channel: 'test' } };

            await handler.routeMessage(peer, message);

            expect(spy).toHaveBeenCalledWith(peer, message);
        });

        it('should route get_status message to sendStatus', async () => {
            const peer = createMockPeer('peer-3');
            const spy = vi.spyOn(handler, 'sendStatus');

            await handler.routeMessage(peer, { type: 'get_status' });

            expect(spy).toHaveBeenCalledWith(peer);
        });

        it('should route change_channel message to changeChannel', async () => {
            const peer = createMockPeer('peer-4');
            const spy = vi.spyOn(handler, 'changeChannel');
            const message = { type: 'change_channel', data: { channel: 'new-channel' } };

            await handler.routeMessage(peer, message);

            expect(spy).toHaveBeenCalledWith(peer, message);
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complete connection lifecycle', async () => {
            const peer = createMockPeer('peer-1', 'ws://localhost:3000/ws?channel=test-channel');

            // Open connection
            await handler.handleOpen(peer);
            expect(mockTransport.subscribe).toHaveBeenCalled();
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"subscription_confirmed"')
            );

            // Send ping
            vi.clearAllMocks();
            await handler.handleMessage(peer, { text: () => JSON.stringify({ type: 'ping' }) });
            expect(peer.send).toHaveBeenCalledWith(expect.stringContaining('"type":"pong"'));

            // Close connection
            vi.clearAllMocks();
            await handler.handleClose(peer);
            expect(mockTransport.removeSubscription).toHaveBeenCalledWith('peer-1');
        });

        it('should handle filter updates after connection', async () => {
            const peer = createMockPeer('peer-1', 'ws://localhost:3000/ws?channel=test-channel');

            // Open connection
            await handler.handleOpen(peer);

            // Update filters
            vi.clearAllMocks();
            const message = {
                text: () => JSON.stringify({
                    type: 'update_filters',
                    data: {
                        channel: 'test-channel',
                        filters: { level: ['error', 'fatal'] },
                    },
                }),
            };
            await handler.handleMessage(peer, message);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'test-channel',
                { level: ['error', 'fatal'] }
            );
        });

        it('should handle channel switching', async () => {
            const peer = createMockPeer('peer-1', 'ws://localhost:3000/ws?channel=channel-1');

            // Open connection to channel-1
            await handler.handleOpen(peer);
            expect(mockTransport.subscribe).toHaveBeenCalledWith(peer, 'channel-1', undefined);

            // Switch to channel-2
            vi.clearAllMocks();
            const message = {
                text: () => JSON.stringify({
                    type: 'change_channel',
                    data: {
                        channel: 'channel-2',
                        filters: { level: ['info'] },
                    },
                }),
            };
            await handler.handleMessage(peer, message);

            expect(mockTransport.subscribe).toHaveBeenCalledWith(
                peer,
                'channel-2',
                { level: ['info'] }
            );
            expect(peer.send).toHaveBeenCalledWith(
                expect.stringContaining('"channel":"channel-2"')
            );
        });
    });
});
