<template>
  <div>
    <h1 class="page-title">Metrics — Web Vitals & Device Stats</h1>
    <p class="page-intro">
      With <code>metrics: true</code> in <code>frogger.config.ts</code>, Frogger auto-collects
      <strong>Web Vitals</strong> (LCP, CLS, INP, FCP, TTFB) and a per-batch
      <strong>device envelope</strong>, then beams them to
      <code>POST /api/_frogger/metrics</code> — a fully separate pipeline from your logs.
    </p>

    <div class="demo-section">
      <h2>Make some vitals fire</h2>
      <p class="hint" style="margin-top: 0;">
        LCP/FCP/TTFB report on load. Click the button to register an interaction (INP), and
        the shifting box below nudges CLS. Then <strong>switch to another tab</strong> (or close
        this one): the queue flushes on <code>visibilitychange → hidden</code> via
        <code>sendBeacon</code>. Watch the Network tab for the metrics POST, and check
        <code>playground/logs/metrics/</code> for the raw JSON-lines.
      </p>

      <button class="btn" @click="poke">Poke me ({{ pokes }})</button>

      <div class="shifter" :style="{ marginTop: shifted ? '2.5rem' : '0.5rem' }">
        A box that moves to nudge Cumulative Layout Shift.
      </div>

      <img
        class="hero"
        width="640"
        height="240"
        alt="A large gradient banner acting as the LCP element"
        :src="heroSrc"
      >
    </div>

    <div class="demo-section">
      <h2>What gets collected</h2>
      <ul>
        <li><code>web.vital.lcp|cls|inp|fcp|ttfb</code> — gauges, timings in <strong>seconds</strong> (CLS unitless)</li>
        <li><code>labels: { rating, route }</code> — indexed dims (route is the <em>pattern</em>, e.g. <code>/metrics</code>)</li>
        <li><code>attr: { id, delta, navigationType }</code> — non-indexed detail</li>
        <li><code>trace: { traceId }</code> — an exemplar pointer to this page's log trace</li>
        <li>a device <code>context</code> envelope (connection, memory, cores, viewport) once per batch</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const pokes = ref(0)
const shifted = ref(false)

function poke() {
  pokes.value++
  shifted.value = !shifted.value
}

// An inline SVG data URI keeps the demo self-contained (no external request) while
// still giving the page a large contentful element for LCP to latch onto.
const heroSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e7d32"/><stop offset="1" stop-color="#66bb6a"/></linearGradient></defs><rect width="640" height="240" rx="12" fill="url(#g)"/><text x="32" y="130" font-family="sans-serif" font-size="34" fill="white">🐸 Frogger metrics</text></svg>`,
)}`
</script>

<style scoped>
.hero { display: block; margin-top: 1rem; max-width: 100%; height: auto; border-radius: 12px; }
.shifter { padding: 0.75rem 1rem; background: var(--surface, #1113); border-radius: 8px; transition: margin-top 0.2s; }
.btn { padding: 0.5rem 1rem; cursor: pointer; }
</style>
