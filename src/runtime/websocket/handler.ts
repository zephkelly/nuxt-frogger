//@ts-ignore
import { defineWebSocketHandler } from '#imports'
import { Peer } from "crossws";

import { WebSocketTransport } from "../logger/_transports/websocket-transport";
import { LogLevelFilter } from "../shared/utils/log-level-filter";

import type {
    LogWebSocketMessage,
    LogWebSocketParams,
    FroggerWebSocketOptions
} from "./types";
import type { SubscriptionFilter } from "./types";



class WebSocketLogHandler {
    private transport: WebSocketTransport;

    constructor() {
        this.transport = WebSocketTransport.getInstance();
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
            
            switch (msg.type) {
                case 'ping':
                await this.sendMessage(peer, { type: 'pong' });
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
        catch (error) {
            console.error('[Frogger] Message handling error:', error);
            await this.sendMessage(peer, {
                type: 'error',
                data: { message: 'Invalid message format' }
            });
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

    private extractParams(peer: Peer): LogWebSocketParams {
        const url = new URL(peer.request?.url || '');
        return this.parseUrlParams(url);
    }

    private parseUrlParams(url: URL): LogWebSocketParams {
        const channel = url.searchParams.get('channel');
        const filtersParam = url.searchParams.get('filters');
        
        let filters: SubscriptionFilter | undefined;
        
        if (filtersParam) {
            try {
                filters = JSON.parse(filtersParam);
            }
            catch {
                console.warn('[Frogger] Invalid filters JSON, ignoring');
            }
        }

        if (!filters) {
            const level = url.searchParams.get('level');
            const tags = url.searchParams.get('tags');
            const sources = url.searchParams.get('sources');

            if (level || tags || sources) {
                filters = {};
                
                if (level) {
                const numLevel = parseInt(level);
                filters.level = isNaN(numLevel) 
                    ? level.split(',') 
                    : LogLevelFilter.getLevelsUpTo(numLevel);
                }
                
                if (tags) filters.tags = tags.split(',');
                if (sources) filters.source = sources.split(',');
            }
        }

        return { channel: channel || undefined, filters };
    }

    private async sendMessage(peer: Peer, message: any) {
        const fullMessage = {
            ...message,
            timestamp: new Date().toISOString()
        };

        await peer.send(JSON.stringify(fullMessage));
    }

    private async closeWithError(peer: Peer, message: string) {
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

    private async updateFilters(peer: Peer, msg: LogWebSocketMessage) {
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

    private async sendStatus(peer: Peer) {
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

    private async changeChannel(peer: Peer, msg: LogWebSocketMessage) {
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

export function defineFroggerWebSocketHandler(options: FroggerWebSocketOptions = {}) {

    const handler = new WebSocketLogHandler();

    return defineWebSocketHandler({
        upgrade(request: Request) {
            if (options.upgrade) {
                return options.upgrade(request);
            }

            if (!import.meta.dev) {
                console.log(
                    '%cFROGGER WARNING', 'color: black; background-color: #0f8dcc; font-weight: bold; font-size: 1.15rem;',
                    '🐸 Logging websocket unprotected! Please provide your own upgrade handler to verify authentication.'
                );
            }
            return true;
        },

        async open(peer: Peer) {
            await handler.handleOpen(peer);
        },

        async message(peer: Peer, message: any) {
            await handler.handleMessage(peer, message);
        },

        async close(peer: Peer) {
            await handler.handleClose(peer);
        },

        async error(peer: Peer, error: any) {
            await handler.handleError(peer, error);
        }
    });
}