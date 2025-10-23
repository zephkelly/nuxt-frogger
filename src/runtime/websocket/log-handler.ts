import { Peer } from "crossws";

import { type IWebSocketTransport } from "./types";
import { WebSocketTransport } from "../logger/_transports/websocket-transport";
import { parseUrlParams } from "./utils/parse-url-params";

import type {
    LogWebSocketMessage,
    LogWebSocketParams,
} from "./types";


export class WebSocketLogHandler {
    private transport: IWebSocketTransport;

    constructor(transport?: IWebSocketTransport) {
        this.transport = transport || WebSocketTransport.getInstance();
    }

    async handleOpen(peer: Peer) {
        try {
            const params = this.extractParams(peer);

            if (!params.channel) {
                throw new Error('Channel parameter is required');
            }

            const success = await this.transport.subscribe(peer, params.channel, params.filters);
            if (!success) {
                throw new Error('Failed to subscribe to log channel');
            }

            await this.sendMessage(peer, {
                type: 'subscription_confirmed',
                channel: params.channel,
                data: {
                    peer_id: peer.id,
                    filters: params.filters,
                    filter_description: this.transport.getFilterDescription(params.filters)
                }
            });
        }
        catch (error: any) {
            console.error('[Frogger] Connection error:', error);
            await this.closeWithError(peer, error.message);
        }
    }

    async handleMessage(peer: Peer, message: any) {
        try {
            const msg: LogWebSocketMessage = JSON.parse(message.text());

            await this.routeMessage(peer, msg);
        }
        catch (error) {
            console.error('[Frogger] Message handling error:', error);
            await this.sendMessage(peer, {
                type: 'error',
                data: { message: 'Invalid message format' }
            });
        }
    }

    async routeMessage(peer: Peer, msg: LogWebSocketMessage) {
        switch (msg.type) {
            case 'ping':
                await this.handlePing(peer);
                break;
            case 'update_filters':
                await this.updateFilters(peer, msg);
                break;
            case 'get_status':
                await this.sendStatus(peer);
                break;
            case 'change_channel':
                await this.changeChannel(peer, msg);
                break;
            default:
                console.warn(`[Frogger] Unknown message type: ${msg.type}`);
        }
    }

    async handleClose(peer: Peer) {
        try {
            await this.transport.removeSubscription(peer.id);
        }
        catch (error) {
            console.error('[Frogger] Close error:', error);
        }
    }

    async handleError(peer: Peer, error: any) {
        console.error('[Frogger] WebSocket error:', error);
        try {
            await this.transport.removeSubscription(peer.id);
        }
        catch (cleanupError) {
            console.error('[Frogger] Cleanup error:', cleanupError);
        }
    }

    extractParams(peer: Peer): LogWebSocketParams {
        const url = new URL(peer.request?.url || '');
        return parseUrlParams(url);
    }

    async sendMessage(peer: Peer, message: any) {
        const fullMessage = {
            ...message,
            timestamp: new Date().toISOString()
        };

        await peer.send(JSON.stringify(fullMessage));
    }

    async closeWithError(peer: Peer, message: string) {
        try {
            await this.sendMessage(peer, {
                type: 'error',
                data: { message }
            });
            await peer.close(1011);
        }
        catch (error) {
            console.error('[Frogger] Error closing peer:', error);
        }
    }

    async handlePing(peer: Peer) {
        await this.sendMessage(peer, { type: 'pong' });
    }

    async updateFilters(peer: Peer, msg: LogWebSocketMessage) {
        try {
            const { filters, channel } = msg.data;

            if (!channel) {
                throw new Error('Channel required for filter update');
            }

            const success = await this.transport.subscribe(peer, channel, filters);

            if (success) {
                await this.sendMessage(peer, {
                    type: 'filters_updated',
                    channel,
                    data: {
                        filters,
                        filter_description: this.transport.getFilterDescription(filters)
                    }
                });
            }
            else {
                throw new Error('Failed to update filters');
            }
        }
        catch (error: any) {
            await this.sendMessage(peer, {
                type: 'error',
                data: { message: `Filter update failed: ${error.message}` }
            });
        }
    }

    async sendStatus(peer: Peer) {
        try {
            const subscription = this.transport.getSubscription(peer.id);
            const status = await this.transport.getStatus();

            await this.sendMessage(peer, {
                type: 'status',
                data: {
                    peer_subscription: subscription ? {
                        channels: subscription.channels,
                        filters: subscription.filters,
                        filter_description: this.transport.getFilterDescription(subscription.filters),
                        subscribed_at: new Date(subscription.subscribed_at),
                        last_activity: new Date(subscription.last_activity)
                    } : null,
                    server_status: status
                }
            });
        }
        catch (error: any) {
            await this.sendMessage(peer, {
                type: 'error',
                data: { message: `Status request failed: ${error.message}` }
            });
        }
    }

    async changeChannel(peer: Peer, msg: LogWebSocketMessage) {
        try {
            const { channel, filters } = msg.data;

            if (!channel) {
                throw new Error('Channel required for channel change');
            }

            const success = await this.transport.subscribe(peer, channel, filters);

            if (success) {
                await this.sendMessage(peer, {
                    type: 'channel_changed',
                    channel,
                    data: {
                        filters,
                        filter_description: this.transport.getFilterDescription(filters)
                    }
                });
            }
            else {
                throw new Error('Failed to change channel');
            }
        }
        catch (error: any) {
            await this.sendMessage(peer, {
                type: 'error',
                data: { message: `Channel change failed: ${error.message}` }
            });
        }
    }
}