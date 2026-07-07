<template>
  <div>
    <h1 class="page-title">Live Logs</h1>
    <p class="page-intro">
      In dev, the server broadcasts every ingested log over a WebSocket.
      <code>useFroggerWebSocket()</code> is a fluent subscriber — pick a channel and filters,
      attach handlers, then <code>connect()</code>. Logs from <em>any</em> page (try opening
      <NuxtLink to="/client-logging">Client Logging</NuxtLink> in another tab) stream in below.
    </p>

    <section class="demo-section">
      <h2>Subscription</h2>
      <p>
        Status: <code>{{ status ?? 'disconnected' }}</code>. Adjust the filters, then connect.
        Reconnecting applies new filters.
      </p>

      <div class="filters">
        <label>
          Channel
          <input v-model="channel" class="btn" type="text" placeholder="main" >
        </label>
        <fieldset class="levels">
          <legend>Levels</legend>
          <label v-for="opt in levelOptions" :key="opt.value">
            <input v-model="selectedLevels" type="checkbox" :value="opt.value" >
            {{ opt.label }}
          </label>
        </fieldset>
      </div>

      <div class="demo-actions">
        <button class="btn btn-primary" :disabled="isOpen" @click="connect">Connect</button>
        <button class="btn" :disabled="!isOpen" @click="disconnect">Disconnect</button>
        <button class="btn" @click="emitTestLogs">Emit test logs</button>
      </div>
      <p class="hint">
        Behind the scenes:
        <code>useFroggerWebSocket().channel(...).levels(...).onMessage(...).connect()</code>.
        Other chainable filters: <code>.type()</code>, <code>.sources()</code>,
        <code>.tags()</code>, <code>.filters()</code>.
      </p>
    </section>

    <section class="demo-section">
      <h2>Stream</h2>
      <LogViewer :logs="logs" @clear="logs = []" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'

interface IncomingLog {
  lvl: number
  type: string
  msg: string
  ctx?: Record<string, any>
  env?: string
  source?: { name?: string; version?: string }
}

const levelOptions = [
  { label: 'error (0)', value: 0 },
  { label: 'warn (1)', value: 1 },
  { label: 'log (2)', value: 2 },
  { label: 'info (3)', value: 3 },
  { label: 'debug (4)', value: 4 },
  { label: 'trace (5)', value: 5 },
]

const channel = ref('main')
const selectedLevels = ref<number[]>([0, 1, 2, 3])
const logs = ref<IncomingLog[]>([])

// useFroggerWebSocket() returns a fresh fluent builder. We keep a handle (in a
// shallowRef so reassigning it re-runs the `status` computed) to read its
// reactive `status` and call `close()`.
const socket = shallowRef<ReturnType<typeof useFroggerWebSocket> | null>(null)
const status = computed(() => (socket.value?.status?.value ?? null))
const isOpen = computed(() => status.value === 'open' || status.value === 'connecting')

function connect() {
  if (isOpen.value) socket.value?.close()

  const instance = useFroggerWebSocket()
    .channel(channel.value || 'main')
    .levels(selectedLevels.value)
    .onConnected(() => frogger.info('live-log socket connected'))
    .onError((_ws: WebSocket, ev: Event) => console.warn('live-log socket error', ev))
    .onMessage((_ws: WebSocket, message: { type?: string, data?: unknown }) => {
      // Broadcast log frames arrive as { type: 'log', data: LoggerObject[] }.
      if (message?.type === 'log' && Array.isArray(message.data)) {
        for (const entry of message.data as IncomingLog[]) {
          logs.value.unshift(entry)
        }
        logs.value = logs.value.slice(0, 200)
      }
    })

  instance.connect()
  socket.value = instance
}

function disconnect() {
  socket.value?.close()
}

function emitTestLogs() {
  const logger = useFrogger({ context: { page: 'live-logs' } })
  logger.info('test info log', { n: Math.round(Math.random() * 100) })
  logger.warn('test warning log')
  logger.error('test error log', { reason: 'demo' })
}
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin-bottom: 1rem;
  align-items: flex-start;
}
.filters label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: var(--muted); }
.filters input[type='text'] { width: 10rem; }
.levels {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.9rem;
}
.levels legend { color: var(--muted); font-size: 0.8rem; padding: 0 0.3rem; }
.levels label { flex-direction: row; align-items: center; gap: 0.35rem; color: var(--text); }
</style>
