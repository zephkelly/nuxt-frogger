<template>
  <div>
    <h1 class="page-title">Scrubbing</h1>
    <p class="page-intro">
      Frogger scrubs PII from your logs before they're stored — on by default. Fields like
      <code>password</code>, <code>email</code>, <code>phone</code>, <code>creditCard</code> and
      names are matched by the built-in rules and masked, redacted, or hashed. The redaction
      happens server-side on the stored record; log the object below and inspect
      <code>playground/logs/</code> to see the result.
    </p>

    <section class="demo-section">
      <h2>Log an object full of PII</h2>
      <p>This client log includes sensitive fields. They'll be scrubbed before being written to disk.</p>
      <pre class="sample">{{ samplePretty }}</pre>
      <div class="demo-actions">
        <button class="btn btn-primary" @click="logFromClient">Log it (client)</button>
        <button class="btn" @click="logFromServer">Log it (server) — GET /api/demo/scrub</button>
      </div>
      <p v-if="serverResult" class="hint">Server returned the scrubbed record: <code>see console</code></p>
    </section>

    <section class="demo-section">
      <h2>Custom rules</h2>
      <p>
        Extend the defaults with your own rules in <code>frogger.config.ts</code> — match by field
        name or RegExp, choose an action (<code>redact_full</code>, <code>mask_partial</code>,
        <code>mask_email</code>, <code>hash_value</code>, …) and a <code>priority</code>.
      </p>
      <pre class="sample">{{ customRuleExample }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const sample = {
  userId: 'u_98217',
  email: 'jane.doe@example.com',
  phone: '+1 (555) 123-4567',
  password: 'hunter2',
  apiKey: 'sk_live_5fThisShouldNeverAppear',
  creditCard: '4111 1111 1111 1111',
  fullName: 'Jane Doe',
  order: { total: 4999, currency: 'USD' },
}

const samplePretty = JSON.stringify(sample, null, 2)

const customRuleExample = `// frogger.config.ts
scrub: {
  rules: [
    {
      action: 'redact_full',
      fieldPatterns: ['authToken', /.*secret.*/i],
      priority: 100,
    },
  ],
}`

const logger = useFrogger({ context: { page: 'scrubbing' } })
function logFromClient() {
  logger.info('user profile (with PII)', sample)
}

const serverResult = ref(false)
async function logFromServer() {
  const res = await $fetch('/api/demo/scrub')
  serverResult.value = true
  console.log('Scrubbed record from server:', res)
}
</script>

<style scoped>
.sample {
  margin: 0 0 0.9rem;
  padding: 0.75rem;
  background: #0b0d11;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.8rem;
  color: #cfd6e0;
}
</style>
