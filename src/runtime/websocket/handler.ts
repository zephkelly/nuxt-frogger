//@ts-ignore
import { defineWebSocketHandler } from '#imports'
import { Peer } from "crossws";

import { WebSocketLogHandler } from "./../websocket/log-handler";
import type { FroggerWebSocketOptions } from "./types";
import { WebSocketTransport } from '../logger/_transports/websocket-transport';
import { createWebSocketStateKVLayer } from './state/factory';

/**
 * Nuxt-specific WebSocket handler wrapper
 * This file is NOT tested directly - we test the WebSocketLogHandler class instead
 * 
 * Usage in your Nuxt server:
 * export default defineFroggerWebSocketHandler({
 *   upgrade: (request) => {
 *     // Your authentication logic
 *     return isAuthenticated(request);
 *   }
 * });
 */
export function defineFroggerWebSocketHandler(options: FroggerWebSocketOptions = {}) {
    const handler = new WebSocketLogHandler(WebSocketTransport.getInstance(createWebSocketStateKVLayer('frogger-websocket')));

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