<template>
  <div>
    <h1 class="page-title">Client Logging</h1>
    <p class="page-intro">
      The <code>useFrogger()</code> composable returns a fresh logger (a fresh trace span).
      Every log is built, scrubbed, batched, and beamed to the server. Open the console and
      the Network tab to watch.
    </p>

    <section class="demo-section">
      <h2>Every log level</h2>
      <p>
        Frogger uses consola's levels. Click any level to emit a log with a small context object.
      </p>
      <div class="demo-actions">
        <button v-for="lvl in levels" :key="lvl" class="btn" @click="emitLevel(lvl)">
          {{ lvl }}()
        </button>
      </div>
      <p class="hint">
        <code>fatal/error</code> = 0, <code>warn</code> = 1, <code>log</code> = 2,
        <code>info/success/fail/ready/start</code> = 3, <code>debug</code> = 4,
        <code>trace</code> = 5.
      </p>
    </section>

    <section class="demo-section">
      <h2>Dynamic level — <code>logLevel()</code></h2>
      <p>Pick a level at runtime and emit it programmatically.</p>
      <div class="demo-actions">
        <select v-model="dynamicLevel" class="btn">
          <option v-for="lvl in levels" :key="lvl" :value="lvl">{{ lvl }}</option>
        </select>
        <button class="btn btn-primary" @click="emitDynamic">logLevel('{{ dynamicLevel }}', …)</button>
      </div>
    </section>

    <section class="demo-section">
      <h2>Context — add / set / clear</h2>
      <p>
        Context is merged into every log this logger makes. <code>addContext</code> merges,
        <code>setContext</code> replaces, <code>clearContext</code> empties.
      </p>
      <div class="demo-actions">
        <button class="btn" @click="doAddContext">addContext()</button>
        <button class="btn" @click="doSetContext">setContext()</button>
        <button class="btn" @click="doClearContext">clearContext()</button>
        <button class="btn btn-primary" @click="logWithContext">info() with current context</button>
      </div>
      <p class="hint">Current context: <code>{{ JSON.stringify(currentContext) }}</code></p>
    </section>

    <section class="demo-section">
      <h2>Child loggers — <code>child()</code> vs <code>reactiveChild()</code></h2>
      <p>
        A child inherits its parent's context. A <code>child()</code> snapshots it;
        a <code>reactiveChild()</code> keeps inheriting parent changes live.
      </p>
      <div class="demo-actions">
        <button class="btn" @click="bumpParent">Update parent context (requestId++)</button>
        <button class="btn" @click="logSnapshotChild">snapshot child.info()</button>
        <button class="btn" @click="logReactiveChild">reactive child.info()</button>
      </div>
      <p class="hint">
        Parent <code>requestId</code> is now <code>{{ requestId }}</code>. The snapshot child
        keeps the value it was created with; the reactive child reflects the latest.
      </p>
    </section>

    <section class="demo-section">
      <h2>Component-scoped logger</h2>
      <p>Each component can own its logger so its logs stay on their own span.</p>
      <Card />
    </section>

    <section class="demo-section">
      <h2>The same API on the server</h2>
      <p>
        <code>getFrogger()</code> mirrors this surface in Nitro — context, child and reactive child
        loggers all work identically. This calls a route that exercises them.
      </p>
      <div class="demo-actions">
        <button class="btn btn-primary" @click="callServerLogging">GET /api/demo/server-logging</button>
      </div>
      <p v-if="serverDone" class="hint">Done — check your terminal and <code>playground/logs/</code>.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

type Level =
  | 'fatal' | 'error' | 'warn' | 'log' | 'info'
  | 'success' | 'fail' | 'ready' | 'start' | 'debug' | 'trace'

const levels: Level[] = ['fatal', 'error', 'warn', 'log', 'info', 'success', 'fail', 'ready', 'start', 'debug', 'trace']

const logger = useFrogger({ context: { page: 'client-logging' } })

function emitLevel(level: Level) {
  logger[level](`${level} from the client`, { at: new Date().toISOString() })
}

const dynamicLevel = ref<Level>('success')
function emitDynamic() {
  logger.logLevel(dynamicLevel.value, `dynamic ${dynamicLevel.value} log`, { dynamic: true })
}

// --- context demo (kept on its own logger so it doesn't fight the level demo) ---
const ctxLogger = useFrogger()
const currentContext = reactive<Record<string, any>>({})

function syncContextPreview(next: Record<string, any>) {
  for (const k of Object.keys(currentContext)) delete currentContext[k]
  Object.assign(currentContext, next)
}
function doAddContext() {
  ctxLogger.addContext({ userId: 'u_123', tier: 'pro' })
  Object.assign(currentContext, { userId: 'u_123', tier: 'pro' })
}
function doSetContext() {
  ctxLogger.setContext({ replaced: true })
  syncContextPreview({ replaced: true })
}
function doClearContext() {
  ctxLogger.clearContext()
  syncContextPreview({})
}
function logWithContext() {
  ctxLogger.info('log carrying the current context')
}

// --- child loggers demo ---
const parentLogger = useFrogger({ context: { requestId: 0 } })
const requestId = ref(0)
const snapshotChild = parentLogger.child({ context: { childKind: 'snapshot' } })
const reactiveChildLogger = parentLogger.reactiveChild({ context: { childKind: 'reactive' } })

function bumpParent() {
  requestId.value++
  parentLogger.setContext({ requestId: requestId.value })
}
function logSnapshotChild() {
  snapshotChild.info('snapshot child log')
}
function logReactiveChild() {
  reactiveChildLogger.info('reactive child log')
}

// --- server logging demo ---
const serverDone = ref(false)
async function callServerLogging() {
  await $fetch('/api/demo/server-logging')
  serverDone.value = true
}
</script>
