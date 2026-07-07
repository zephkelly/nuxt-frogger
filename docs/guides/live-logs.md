# Live Logs (WebSocket)

In development, once the `websocket` subsystem is enabled, Frogger broadcasts every log it
ingests over a WebSocket. The `useFroggerWebSocket()` composable lets you subscribe to that
stream from your app — perfect for building a live console, a debug overlay, or a custom
dashboard. The live-stream is **opt-in** (see [enabling it](#configuration) below).

::: warning Dev only
The live-stream WebSocket handler is registered **only in development**. There is no
production log-reading path — in production, logs are written to rotated JSON-lines files on
disk (see [Transports](/guides/transports)). `useFroggerWebSocket()` is also only auto-imported
when **both** `websocket` and `serverModule` are enabled. `serverModule` is on by default, but
the live-stream `websocket` is **opt-in** — enable it explicitly:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    frogger: { websocket: true }        // or preset: 'full'
})
```

See [Presets](../configuration.md#presets) for the `full` preset, which turns on the websocket
along with the other opt-in subsystems.
:::

## Quick start

`useFroggerWebSocket()` returns a fluent builder. Pick a channel and some filters, attach
handlers, then call `connect()`:

```vue
<script setup lang="ts">
const socket = useFroggerWebSocket()
    .channel('main')                       // [!code focus]
    .levels([0, 1, 2, 3])                  // [!code focus]
    .onMessage((ws, message) => {          // [!code focus]
        if (message.type === 'log') {      // [!code focus]
            console.log('logs:', message.data) // [!code focus]
        }                                  // [!code focus]
    })                                     // [!code focus]
    .connect()                             // [!code focus]
</script>
```

Incoming log frames have the shape `{ type: 'log', channel, timestamp, data, meta }`, where
**`data` is an array of [`LoggerObject`](/reference/logger-api#loggerobject)** — a single frame
may carry a batch of logs.

## Filtering

Every filter is chainable. Combine as many as you like — they're ANDed together.

| Method | Filters by | Example |
| --- | --- | --- |
| `.channel(name)` | Channel name (default `'main'`) | `.channel('payments')` |
| `.levels(levels)` | Log levels (numbers or names) | `.levels([0, 1])` / `.levels(['error', 'warn'])` |
| `.type(types)` | Log type(s) | `.type(['error', 'fatal'])` |
| `.sources(sources)` | Source app name(s) | `.sources(['my-api'])` |
| `.tags(tags)` | Log tags | `.tags(['checkout'])` |
| `.filters(obj)` | Several at once | `.filters({ level: [0, 1], tags: ['auth'] })` |

```ts
const socket = useFroggerWebSocket()
    .channel('main')
    .levels(['error', 'warn'])     // only errors and warnings
    .sources(['checkout-service']) // from one app
    .tags(['payment'])
    .onMessage((ws, message) => { /* ... */ })
    .connect()
```

## Handlers

```ts
useFroggerWebSocket()
    .onConnected((ws) => console.log('connected'))
    .onMessage((ws, message) => { /* every message */ })
    .onError((ws, event) => console.warn('socket error', event))
    .connect()
```

## Reactive state & control

The returned instance exposes reactive state and imperative controls:

```ts
const socket = useFroggerWebSocket().channel('main')
socket.connect()

socket.status      // Ref<WebSocketStatus> — 'connecting' | 'open' | 'closed' | 'timeout'
socket.lastMessage // Ref<LogWebSocketMessage | null>
socket.ws          // Ref<WebSocket | undefined>

socket.send({ type: 'ping' }) // send a message
socket.close()                // close the connection
```

::: tip Reconnecting with new filters
To change filters at runtime, `close()` the current socket and build a fresh
`useFroggerWebSocket()` with the new filters, then `connect()` again. See the playground's
`live-logs` page for a worked example with checkboxes that rebuild the subscription.
:::

## A minimal live console

```vue
<script setup lang="ts">
import { ref } from 'vue'

// Each entry in `message.data` is a LoggerObject. A minimal shape for display:
interface LogEntry { type: string; msg: string; lvl: number; ctx?: Record<string, any> }

const logs = ref<LogEntry[]>([])

useFroggerWebSocket()
    .channel('main')
    .levels([0, 1, 2, 3, 4, 5])
    .onMessage((ws, message) => {
        if (message.type === 'log' && Array.isArray(message.data)) {
            logs.value.unshift(...message.data)
            logs.value = logs.value.slice(0, 200)
        }
    })
    .connect()
</script>

<template>
    <ul>
        <li v-for="(log, i) in logs" :key="i">
            <strong>{{ log.type }}</strong> {{ log.msg }}
        </li>
    </ul>
</template>
```

## Configuration

The live-stream is off by default. Turn it on with `websocket: true` (sensible defaults) or
the [`full` preset](../configuration.md#presets). Passing an object both enables it and
configures the route and limits under the `websocket` module option:

```ts
export default defineNuxtConfig({
    modules: ['nuxt-frogger'],
    frogger: {
        websocket: {
            route: '/api/_frogger/dev-ws', // default
            defaultChannel: 'main',
            // Gate who may open the socket (return false to reject):
            upgrade: (request) => true,
            maxConcurrentQueries: 10,
            maxQueryResults: 1000,
            defaultQueryTimeout: 30000,
        },
    },
})
```

See the [Configuration](/configuration) page for the full `websocket` option reference.
