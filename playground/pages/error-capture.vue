<template>
  <div>
    <h1 class="page-title">Error Capture</h1>
    <p class="page-intro">
      Frogger installs global error handlers on both ends. On the client it hooks Vue's
      <code>errorHandler</code> (render, lifecycle, watcher and event-handler errors). On the
      server it hooks Nitro's <code>error</code> hook plus <code>process</code> events. Captured
      errors are logged at <code>error</code>/<code>fatal</code> with the stack in <code>ctx</code>.
    </p>

    <section class="demo-section">
      <h2>Client — error in an event handler</h2>
      <p>Throwing inside a <code>@click</code> handler is routed to Vue's error handler and logged automatically.</p>
      <div class="demo-actions">
        <button class="btn btn-danger" @click="throwInHandler">Throw in click handler</button>
      </div>
      <p class="hint">Check the console / Network tab — you'll see an <code>error</code> log with <code>uncaught: true</code>.</p>
    </section>

    <section class="demo-section">
      <h2>Client — error in a watcher</h2>
      <p>Watcher callbacks are wrapped too. Toggling this value throws inside a <code>watch</code>.</p>
      <div class="demo-actions">
        <button class="btn btn-danger" @click="trigger++">Trigger watcher error</button>
      </div>
    </section>

    <section class="demo-section">
      <h2>Server — uncaught route error</h2>
      <p>
        This route throws. Nitro's <code>error</code> hook captures it and Frogger logs it server-side
        (look in your terminal and <code>playground/logs/</code>).
      </p>
      <div class="demo-actions">
        <button class="btn btn-danger" @click="callServerError">GET /api/demo/error</button>
      </div>
      <p v-if="serverStatus" class="hint">Response status: <code>{{ serverStatus }}</code> (the 500 is expected — the error was captured).</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

function throwInHandler() {
  throw new Error('Boom — thrown from a client event handler')
}

const trigger = ref(0)
watch(trigger, (v) => {
  throw new Error(`Boom — thrown from a watcher (trigger=${v})`)
})

const serverStatus = ref<number | null>(null)
async function callServerError() {
  serverStatus.value = null
  try {
    await $fetch('/api/demo/error')
  } catch (err: any) {
    serverStatus.value = err?.statusCode ?? err?.response?.status ?? 500
  }
}
</script>
