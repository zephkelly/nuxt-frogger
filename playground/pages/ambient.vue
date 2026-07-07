<template>
  <div>
    <h1 class="page-title">Ambient Logger</h1>
    <p class="page-intro">
      <code>frogger</code> is an auto-imported, variadic drop-in for <code>console.*</code>.
      Same method names, but a trailing plain object becomes the structured <code>ctx</code>,
      remaining args are joined into <code>msg</code>, and an <code>Error</code> is lifted
      into <code>ctx.error</code>. It's backed by a single span chain per app (client) / per
      request (server).
    </p>

    <section class="demo-section">
      <h2>Just like console</h2>
      <p>Call it with a plain string — nothing else to set up.</p>
      <div class="demo-actions">
        <button class="btn" @click="logSimple">frogger.info('hello')</button>
        <button class="btn" @click="logWarn">frogger.warn('careful')</button>
      </div>
    </section>

    <section class="demo-section">
      <h2>Variadic with structure</h2>
      <p>A trailing object is captured as <code>ctx</code>; leading values are joined into <code>msg</code>.</p>
      <div class="demo-actions">
        <button class="btn" @click="logTrailingObject">frogger.info('cart total', total, &#123; cartId &#125;)</button>
        <button class="btn" @click="logMultipleArgs">frogger.log('counts', 5, 10)</button>
      </div>
      <p class="hint">
        <code>'cart total', 5499, { cartId }</code> →
        <code>msg: 'cart total 5499'</code>, <code>ctx: { cartId }</code>.
      </p>
    </section>

    <section class="demo-section">
      <h2>Error lifting</h2>
      <p>Pass an <code>Error</code> and Frogger folds its message into <code>msg</code> and the full error (with stack) into <code>ctx.error</code>.</p>
      <div class="demo-actions">
        <button class="btn btn-danger" @click="logError">frogger.error('checkout failed', err, &#123; orderId &#125;)</button>
      </div>
    </section>

    <section class="demo-section">
      <h2>Server ambient</h2>
      <p>
        The same <code>frogger</code> object is auto-imported in Nitro. Hit the endpoint to see a
        server-side ambient log that stays correlated with this request's trace.
      </p>
      <div class="demo-actions">
        <button class="btn btn-primary" @click="callServerAmbient">GET /api/demo/ambient</button>
      </div>
      <p v-if="serverReply" class="hint">Server replied: <code>{{ serverReply }}</code></p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

function logSimple() {
  frogger.info('hello from the ambient logger')
}
function logWarn() {
  frogger.warn('careful — this is a warning')
}
function logTrailingObject() {
  const total = 5499
  const cartId = 'cart_abc'
  frogger.info('cart total', total, { cartId })
}
function logMultipleArgs() {
  frogger.log('counts', 5, 10)
}
function logError() {
  const err = new Error('Payment provider timed out')
  frogger.error('checkout failed', err, { orderId: 'ord_42' })
}

const serverReply = ref<string | null>(null)
async function callServerAmbient() {
  const res = await $fetch<{ ok: boolean }>('/api/demo/ambient')
  serverReply.value = JSON.stringify(res)
}
</script>
