<template>
  <div>
    <h1 class="page-title">🐸 Frogger Playground</h1>
    <p class="page-intro">
      A live sandbox for the <code>nuxt-frogger</code> module. Each page focuses on one
      feature with buttons that actually emit logs — open your console, the Network tab,
      and your dev terminal to watch them flow.
    </p>

    <div class="demo-section">
      <h2>What's in here</h2>
      <ul class="overview-list">
        <li v-for="item in pages" :key="item.to">
          <NuxtLink :to="item.to">{{ item.title }}</NuxtLink>
          <span> — {{ item.desc }}</span>
        </li>
      </ul>
    </div>

    <div class="demo-section">
      <h2>How logs travel</h2>
      <p>
        Client logs are <strong>batched and beamed</strong> to the server over HTTP
        (<code>POST /api/_frogger/logs</code>), where they're scrubbed, rate-limited, and
        written to rotated JSON-lines files under <code>playground/logs/</code>. In dev they
        are also broadcast over a WebSocket — that's what the <NuxtLink to="/live-logs">Live
        Logs</NuxtLink> page subscribes to.
      </p>
      <p class="hint" style="margin-top: 0;">
        Tip: the playground sets <code>NUXT_PUBLIC_FROGGER_BATCH_MAX_AGE=1</code> in
        <code>.env</code> so client batches flush almost immediately — handy for a demo.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const pages = [
  { to: '/client-logging', title: 'Client Logging', desc: 'useFrogger(), every level, context, child loggers' },
  { to: '/ambient', title: 'Ambient Logger', desc: 'the variadic `frogger` drop-in for console.*' },
  { to: '/trace-context', title: 'Trace Context', desc: 'W3C trace propagation from client → server → downstream' },
  { to: '/live-logs', title: 'Live Logs', desc: 'subscribe to the dev WebSocket with useFroggerWebSocket()' },
  { to: '/error-capture', title: 'Error Capture', desc: 'automatic capture of Vue errors and unhandled rejections' },
  { to: '/scrubbing', title: 'Scrubbing', desc: 'PII redaction in action, client and server' },
  { to: '/metrics', title: 'Metrics', desc: 'Web Vitals + device stats, beamed to /api/_frogger/metrics' },
]
</script>

<style scoped>
.overview-list { margin: 0; padding-left: 1.1rem; }
.overview-list li { margin-bottom: 0.4rem; }
.overview-list span { color: var(--muted); font-size: 0.92rem; }
</style>
