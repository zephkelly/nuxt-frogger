<template>
  <div>
    <h1 class="page-title">Trace Context</h1>
    <p class="page-intro">
      Every logger is a trace span. <code>getHeaders()</code> emits W3C
      <code>traceparent</code> / <code>tracestate</code> headers — pass them along with a request
      and the server continues the same trace. The last log on the client becomes the parent of
      the first log on the server.
    </p>

    <section class="demo-section">
      <h2>Inspect the headers</h2>
      <p>These are generated from the current logger's trace + span IDs.</p>
      <div class="demo-actions">
        <button class="btn" @click="showHeaders">getHeaders()</button>
        <button class="btn" @click="showCustomVendor">getHeaders('my-vendor')</button>
      </div>
      <pre v-if="headers" class="headers">{{ headers }}</pre>
    </section>

    <section class="demo-section">
      <h2>Propagate client → server → downstream</h2>
      <p>
        This logs on the client, then calls <code>/api/demo/trace</code> with the trace headers.
        That route logs, then calls a second downstream route — so one trace spans three hops.
        Confirm the shared <code>traceId</code> in the response and in your terminal / log file.
      </p>
      <div class="demo-actions">
        <button class="btn btn-primary" @click="runTrace">Run a 3-hop trace</button>
      </div>
      <pre v-if="traceResult" class="headers">{{ traceResult }}</pre>
      <p class="hint">
        Open <code>playground/logs/</code> and grep for the <code>traceId</code> below — every hop
        shares it, with each span pointing at its parent.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const logger = useFrogger({ context: { page: 'trace-context' } })
const headers = ref<string | null>(null)
const traceResult = ref<string | null>(null)

function showHeaders() {
  headers.value = JSON.stringify(logger.getHeaders(), null, 2)
}
function showCustomVendor() {
  headers.value = JSON.stringify(logger.getHeaders('my-vendor'), null, 2)
}

async function runTrace() {
  logger.info('starting a traced request from the client')

  const res = await $fetch<Record<string, any>>('/api/demo/trace', {
    headers: logger.getHeaders(),
  })

  traceResult.value = JSON.stringify(res, null, 2)
}
</script>

<style scoped>
.headers {
  margin-top: 0.9rem;
  padding: 0.75rem;
  background: #0b0d11;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.8rem;
  color: #cfd6e0;
}
</style>
