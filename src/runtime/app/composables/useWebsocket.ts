import { ref, onMounted, onBeforeUnmount, nextTick, watch } from "vue"
// import { navigateTo } from "#imports"

import { MessageType, type LogWebSocketMessage, WebSocketMessageAuthor, WebSocketStatus } from "../../websocket/types"



interface WebSocketOptions {
    auto_connect?: boolean
    reconnect?: {
        auto_reconnect?: boolean
        interval?: number
        delay?: number
        attempts?: number | 'unlimited'
        onReconnectFailed?: () => void
    }
    heartbeat?: {
        auto_heartbeat?: boolean
        interval?: number
        message?: LogWebSocketMessage
        response_timeout?: number
    },
    queryParams?: Record<string, string>
    onConnected?: (socket: WebSocket) => void
    onDisconnected?: (ws: WebSocket, event: CloseEvent) => void
    onMessage?: (ws: WebSocket, message: LogWebSocketMessage) => void
    onError?: (ws: WebSocket, event: Event) => void
}

const DEFAULT_OPTIONS: Required<WebSocketOptions> = {
    auto_connect: false,
    reconnect: {
        auto_reconnect: true,
        interval: 1000,
        delay: 1000,
        attempts: 3,
        onReconnectFailed: () => {}
    },
    heartbeat: {
        auto_heartbeat: true,
        interval: 1000 * 60,
        response_timeout: 5000,
        message: {
            type: 'ping'
        }
    },
    queryParams: {},
    onConnected: () => {},
    onDisconnected: () => {},
    onMessage: () => {},
    onError: () => {}
}

export const useWebsocket = (
    url: string,
    socket_options: WebSocketOptions = {},
    channel?: string
) => {
    if (import.meta.server) {
        return
    }

    const options = {
        ...DEFAULT_OPTIONS,
        ...socket_options,
        reconnect: {
            ...DEFAULT_OPTIONS.reconnect,
            ...socket_options.reconnect
        },
        heartbeat: {
            ...DEFAULT_OPTIONS.heartbeat,
            ...socket_options.heartbeat
        },
        queryParams: {
            ...DEFAULT_OPTIONS.queryParams,
            ...socket_options.queryParams
        }
    }

    const {
        onConnected,
        onMessage,
        onError,
        auto_connect,
        reconnect,
        heartbeat
    } = options;

    const urlRef = ref<string>(url);
    const status = ref<WebSocketStatus>(WebSocketStatus.Closed);
    const socket = ref<WebSocket | undefined>(undefined);
    const channelRef = ref<string | undefined>(channel);

    let intentionallyClosed = false;
    let reconnectAttempts = 0;

    let heartbeatInterval: ReturnType<typeof setInterval> | undefined
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
    let awaitingHeartbeatResponse = false;

    const lastMessage = ref<LogWebSocketMessage | null>(null)
    let bufferedData: (LogWebSocketMessage)[] = []

    function send(data: LogWebSocketMessage, useBuffer = true) {
        if (!socket.value || status.value !== WebSocketStatus.Open) {
            if (useBuffer) {
                bufferedData.push(data)
            }

            return false
        }

        sendBuffer()
        socket.value.send(JSON.stringify(data))

        if (data.type === MessageType.Ping) {
            setupHeartbeatTimeout()
        }

        return true
    }

    function sendBuffer() {
        if (bufferedData.length && socket.value && status.value === WebSocketStatus.Open) {
            for (const buffer of bufferedData) {
                socket.value.send(JSON.stringify(buffer))
            }

            bufferedData = []
        }
    }

    function connect(channel?: string, queryParams?: Record<string, string>) {
        if (channel) {
            channelRef.value = channel
        }

        if (queryParams) {
            options.queryParams = {
                ...options.queryParams,
                ...queryParams
            }
        }

        if (import.meta.server) {
            return;
        }

        close()
        intentionallyClosed = false
        setup()
    }

    function close(code = 1000, tryReconnect: boolean = false) {
        if (import.meta.server || !socket.value) {
            return;
        }

        intentionallyClosed = !tryReconnect
        stopHeartbeat()
        clearHeartbeatTimeout()
        socket.value.close(code)
        socket.value = undefined
    }

    function setup() {
        if (intentionallyClosed || typeof urlRef.value === "undefined" || urlRef.value === "") {
            return
        }

        const ws = new WebSocket(buildSocketUrl())
        socket.value = ws
        status.value = WebSocketStatus.Connecting

        ws.onopen = () => {
            status.value = WebSocketStatus.Open
            onConnected?.(ws)
            startHeartbeat()
            sendBuffer()
        }

        ws.onclose = (event) => {
            stopHeartbeat()
            clearHeartbeatTimeout()
            status.value = WebSocketStatus.Closed
            socket.value = undefined

            if ((!intentionallyClosed && event.code !== 1000) && reconnect.auto_reconnect) {
                if (reconnect.attempts === 'unlimited' || (typeof reconnect.attempts === "number" && (reconnectAttempts < 0 || reconnectAttempts < reconnect.attempts))) {
                    reconnectAttempts++
            
                    const backoffTime = Math.min(reconnect.delay! * Math.pow(2, reconnectAttempts), 30000);
                    setTimeout(setup, backoffTime)
                }
                else {
                    status.value = WebSocketStatus.Timeout
                    reconnect.onReconnectFailed?.()
                }
            }
        }

        ws.onerror = (event) => {
            console.log("Websocket error", event)
            onError?.(ws, event)
        }

        ws.onmessage = async (event: MessageEvent) => {     
            if (heartbeat.auto_heartbeat) {
                resetHeartbeat()
            }

            if (!event.data) return

            let message
            if (event.data instanceof Blob) {
                const text = await event.data.text()
                message = JSON.parse(text)
            } else {
                message = JSON.parse(event.data)
            }

            if (message.from === WebSocketMessageAuthor.Server && message.type === MessageType.Connected) {
                reconnectAttempts = 0
            }

            if (message.type === MessageType.Pong && awaitingHeartbeatResponse) {
                clearHeartbeatTimeout();
            }

            if (message.type === MessageType.Error) {
                if (message.data.code === 401) {
                    intentionallyClosed = true
                    close(1000, false)
                    //@ts-ignore
                    await navigateTo('/')
                }
            }

            lastMessage.value = message
            onMessage?.(ws, message)
        }
    }

    function buildSocketUrl(): string {
        const params = new URLSearchParams();
        
        if (channelRef.value) {
            params.append('channel', channelRef.value);
        }
        
        Object.entries(options.queryParams).forEach(([key, value]) => {
            params.append(key, value);
        });

        const queryString = params.toString();
        return queryString ? `${urlRef.value}?${queryString}` : urlRef.value;
    }

    // Heartbeat
    function startHeartbeat() {
        if (!heartbeat.auto_heartbeat || !socket.value || !heartbeat.message) {
            return
        }

        if (heartbeatInterval) {
            clearInterval(heartbeatInterval)
        }

        heartbeatInterval = setInterval(() => {
            send(heartbeat.message!)
        }, heartbeat.interval)
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval)
        }

        clearHeartbeatTimeout()
    }

    function setupHeartbeatTimeout() {
        if (!heartbeat.response_timeout || awaitingHeartbeatResponse) {
            return
        }

        clearHeartbeatTimeout()
        awaitingHeartbeatResponse = true
        heartbeatTimeout = setTimeout(handleHeartbeatTimeout, heartbeat.response_timeout)
    }

    function handleHeartbeatTimeout() {
        console.log("Heartbeat timeout")
        close(1000, true)
    }

    function clearHeartbeatTimeout() {
        if (heartbeatTimeout) {
            clearTimeout(heartbeatTimeout)
            heartbeatTimeout = undefined
        }

        awaitingHeartbeatResponse = false
    }


    function resetHeartbeat() {
        stopHeartbeat()
        startHeartbeat()
    }

    watch(urlRef, () => {
        connect()
    });

    if (auto_connect) {
        onMounted(() => {
            nextTick(() => {
                connect()
            });
        });
    }

    onBeforeUnmount(() => {
        close();
    });

    return {
        status,
        ws: socket,
        send,
        connect,
        close,
        lastMessage,
    }
}
