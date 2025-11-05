//@ts-ignore
import { defineWebSocketHandler } from '#imports'
import { Peer } from "crossws";

import { WebSocketLogHandler } from "./../websocket/log-handler";
import type { FroggerWebSocketOptions } from "./types";
import { WebSocketTransport } from '../logger/_transports/websocket-transport';
import { createWebSocketStateKVLayer } from './state/factory';




let handlerInstance: WebSocketLogHandler | null = null;

function getHandler(): WebSocketLogHandler {
    if (!handlerInstance) {
        const stateLayer = createWebSocketStateKVLayer('frogger-websocket');
        
        const transport = WebSocketTransport.getInstance(stateLayer);
        handlerInstance = new WebSocketLogHandler(transport);
    }
    return handlerInstance;
}


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
            const handler = getHandler();
            await handler.handleOpen(peer);
        },
        async message(peer: Peer, message: any) {
            const handler = getHandler();
            await handler.handleMessage(peer, message);
        },
        async close(peer: Peer) {
            const handler = getHandler();
            await handler.handleClose(peer);
        },
        async error(peer: Peer, error: any) {
            const handler = getHandler();
            await handler.handleError(peer, error);
        }
    });
}