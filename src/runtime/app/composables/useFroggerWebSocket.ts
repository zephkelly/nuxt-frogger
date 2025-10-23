import { type Ref, ref } from "vue"
import { useWebSocket } from "./useWebSocket"
import type { LogWebSocketMessage, SubscriptionFilter, WebSocketStatus } from "../../websocket/types"
import type { LogLevelInput } from "../../shared/utils/log-level-parser"

interface FroggerWebsocketInstance {
    channel(channelName: string): FroggerWebsocketInstance
    levels(levels: LogLevelInput[]): FroggerWebsocketInstance
    type(types: string | string[]): FroggerWebsocketInstance
    sources(sources: string[]): FroggerWebsocketInstance
    tags(tags: string[]): FroggerWebsocketInstance
    filters(filters: SubscriptionFilter): FroggerWebsocketInstance
    onMessage(handler: (ws: WebSocket, message: LogWebSocketMessage) => void): FroggerWebsocketInstance
    onConnected(handler: (ws: WebSocket) => void): FroggerWebsocketInstance
    onError(handler: (ws: WebSocket, event: Event) => void): FroggerWebsocketInstance
    connect(): void

    status: Ref<WebSocketStatus>
    ws: Ref<WebSocket | undefined>
    send(data: LogWebSocketMessage, useBuffer?: boolean): boolean
    close(code?: number, tryReconnect?: boolean): void
    lastMessage: Ref<LogWebSocketMessage | null>
}

export const useFroggerWebSocket = () => {
    if (import.meta.server) {
        return {
            channel: () => ({}),
            levels: () => ({}),
            type: () => ({}),
            sources: () => ({}),
            tags: () => ({}),
            filters: () => ({}),
            onMessage: () => ({}),
            onConnected: () => ({}),
            onError: () => ({}),
            connect: () => { },
            status: ref(null),
            ws: ref(undefined),
            send: () => false,
            close: () => { },
            lastMessage: ref(null)
        } as any
    }

    let channelName: string = 'main'
    let filter: SubscriptionFilter = {}
    let messageHandler: ((ws: WebSocket, message: LogWebSocketMessage) => void) | undefined
    let connectedHandler: ((ws: WebSocket) => void) | undefined
    let errorHandler: ((ws: WebSocket, event: Event) => void) | undefined

    let socket: ReturnType<typeof useWebSocket> | undefined

    const instance: FroggerWebsocketInstance = {
        channel(name: string) {
            channelName = name
            return instance
        },

        levels(levels: LogLevelInput[]) {
            filter.level = levels
            return instance
        },

        type(types: string | string[]) {
            filter.type = Array.isArray(types) ? types as any : types as any
            return instance
        },

        sources(sources: string[]) {
            filter.source = sources
            return instance
        },

        tags(tags: string[]) {
            filter.tags = tags
            return instance
        },

        filters(filters: SubscriptionFilter) {
            filter = { ...filter, ...filters }
            return instance
        },

        onMessage(handler: (ws: WebSocket, message: LogWebSocketMessage) => void) {
            messageHandler = handler
            return instance
        },

        onConnected(handler: (ws: WebSocket) => void) {
            connectedHandler = handler
            return instance
        },

        onError(handler: (ws: WebSocket, event: Event) => void) {
            errorHandler = handler
            return instance
        },

        connect() {
            socket = useWebSocket({
                onMessage: messageHandler,
                onConnected: connectedHandler,
                onError: errorHandler,
            })

            const queryParams: Record<string, string> = {}

            if (Object.keys(filter).length > 0) {
                queryParams.filters = JSON.stringify(filter)
            }

            socket?.connect(channelName, queryParams)
        },

        get status() {
            return socket?.status!
        },

        get ws() {
            return socket?.ws!
        },

        send(data: LogWebSocketMessage, useBuffer = true) {
            return socket?.send(data, useBuffer) || false
        },

        close(code = 1000, tryReconnect = false) {
            socket?.close(code, tryReconnect)
        },

        get lastMessage() {
            return socket?.lastMessage!
        }
    }

    return instance
}
